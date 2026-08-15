import {
  buildStoredMonthlyReport,
  listClosedActivityMonths,
  type BilanReadingFact,
} from "@/lib/scoring/closed-months";
import type { Month, MonthlyObjective, PurchaseFact } from "@/lib/scoring/types";
import type { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

/**
 * L'entretien des agrégats de mois clos (epic #182 — le socle de §4.14 Amis).
 *
 * Appelé par la page Bilan, qui a DÉJÀ tous les faits en main (le contrat du
 * moteur les exige de toute façon) : quand la version des faits a bougé
 * depuis le dernier calcul — un trigger la bumpe à chaque écriture qui touche
 * au barème — on recalcule TOUS les mois clos (même coût qu'un affichage
 * d'aujourd'hui, payé une fois par modification au lieu d'à chaque visite) et
 * on remplace les lignes. Sinon : une seule lecture de version, zéro écriture.
 *
 * JAMAIS bloquant : le Bilan affiché reste le calcul en direct (fuseau de
 * l'appareil, fraîcheur au geste) — un échec ici se logge (#181) et se
 * rattrapera à la prochaine visite. Les lignes servent aux CONSOMMATEURS
 * d'agrégats : §4.14 en tête.
 */

type SessionSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

/** La version « jamais bumpée » : cohérente avec le `values (owner, 2)` du trigger. */
const INITIAL_FACT_VERSION = 1;

export async function syncMonthlyReports(
  supabase: SessionSupabaseClient,
  userId: string,
  currentMonth: Month,
  facts: {
    readings: BilanReadingFact[];
    purchases: PurchaseFact[];
    objectivesByMonth: Record<string, MonthlyObjective>;
  },
): Promise<void> {
  try {
    const [{ data: versionRow }, { data: storedRows }] = await Promise.all([
      supabase.from("user_fact_versions").select("version").eq("user_id", userId).maybeSingle(),
      supabase.from("monthly_reports").select("month, fact_version").eq("user_id", userId),
    ]);
    const currentVersion = versionRow?.version ?? INITIAL_FACT_VERSION;

    const closedMonths = listClosedActivityMonths(facts, currentMonth);
    const stored = storedRows ?? [];
    const storedByMonth = new Map(stored.map((row) => [row.month.slice(0, 7), row.fact_version]));

    const isFresh =
      closedMonths.every((month) => storedByMonth.get(month) === currentVersion) &&
      stored.every((row) => closedMonths.includes(row.month.slice(0, 7)));
    if (isFresh) return;

    // Remplacement complet : upsert des mois clos actifs, purge des lignes de
    // mois redevenus vides (tout supprimé rétroactivement) ou pas encore clos.
    if (closedMonths.length > 0) {
      const { error: upsertError } = await supabase.from("monthly_reports").upsert(
        closedMonths.map((month) => ({
          user_id: userId,
          month: `${month}-01`,
          report: buildStoredMonthlyReport(month, facts) as unknown as Json,
          fact_version: currentVersion,
          computed_at: new Date().toISOString(),
        })),
        { onConflict: "user_id,month" },
      );
      if (upsertError) throw new Error(upsertError.message);
    }
    const staleRows = stored.filter((row) => !closedMonths.includes(row.month.slice(0, 7)));
    if (staleRows.length > 0) {
      const { error: deleteError } = await supabase
        .from("monthly_reports")
        .delete()
        .eq("user_id", userId)
        .in("month", staleRows.map((row) => row.month));
      if (deleteError) throw new Error(deleteError.message);
    }
  } catch (error) {
    console.error("[bilan] syncMonthlyReports:", error instanceof Error ? error.message : String(error));
  }
}
