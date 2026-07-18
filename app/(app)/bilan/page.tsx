import { MonthlyReportView } from "@/components/bilan/monthly-report-view";
import type { BilanReading, MonthlyPickRecord } from "@/components/bilan/monthly-report-view";
import { PageLoadError } from "@/components/page-load-error";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { MonthlyObjective, PurchaseFact } from "@/lib/scoring/types";

/**
 * Le bilan mensuel au barème — l'écran principal, LE livrable (specs §4.5) :
 * exactement ce qu'on lit à l'antenne. On charge TOUS les faits une fois
 * (contrat du moteur : les lectures terminées de tous les mois, pour
 * l'annulation du malus) et la navigation entre les mois se fait côté client,
 * sans re-requête — le score est toujours dérivé, jamais stocké (§4.7).
 * Les objectifs (§4.11) et distinctions (§4.4) suivent le même contrat :
 * tout arrive d'un coup, le client pioche le mois affiché.
 */
export default async function BilanPage() {
  const supabase = await createServerSupabaseClient();

  const [readingsResult, purchasesResult, objectivesResult, picksResult] = await Promise.all([
    // L'inner join sur books élague les livres supprimés en douceur : sans lui,
    // les lectures/achats d'un livre effacé pèseraient au bilan tout en ayant
    // disparu de la PAL. book_id est NOT NULL → l'inner join ne perd rien.
    // `id` et `title` servent aux distinctions (choisir une lecture du mois).
    supabase
      .from("readings")
      .select("id, book_id, status, started_at, finished_at, book:books!inner (title, category, deleted_at)")
      .eq("status", "finished")
      .is("deleted_at", null)
      .is("book.deleted_at", null),
    supabase
      .from("purchases")
      .select("book_id, purchased_at, book:books!inner (deleted_at)")
      .is("deleted_at", null)
      .is("book.deleted_at", null),
    supabase.from("monthly_objectives").select("month, objective_targets (category, target_count)"),
    supabase.from("monthly_picks").select("month, kind, reading_id, comment"),
  ]);

  if (readingsResult.error || purchasesResult.error || objectivesResult.error || picksResult.error) {
    return <PageLoadError title="Bilan du mois" message="Impossible de charger le bilan — réessaie." />;
  }

  // L'embed `book` est inféré objet (FK many-to-one) : plus de tableau à déplier.
  const readings: BilanReading[] = (readingsResult.data ?? []).map((row) => ({
    readingId: row.id,
    title: row.book.title,
    bookId: row.book_id,
    category: row.book.category,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }));

  const purchases: PurchaseFact[] = (purchasesResult.data ?? []).map((row) => ({
    bookId: row.book_id,
    purchasedAt: row.purchased_at,
  }));

  // En base un mois est un `date` au 1er — le moteur parle en `YYYY-MM`.
  const objectivesByMonth: Record<string, MonthlyObjective> = Object.fromEntries(
    (objectivesResult.data ?? []).map((row) => [
      row.month.slice(0, 7),
      Object.fromEntries(row.objective_targets.map((target) => [target.category, target.target_count])),
    ]),
  );

  const picks: MonthlyPickRecord[] = (picksResult.data ?? []).map((row) => ({
    month: row.month.slice(0, 7),
    kind: row.kind,
    readingId: row.reading_id,
    comment: row.comment,
  }));

  return (
    <section className="py-6">
      <h1 className="text-2xl font-bold">Bilan du mois</h1>
      <MonthlyReportView readings={readings} purchases={purchases} objectivesByMonth={objectivesByMonth} picks={picks} />
    </section>
  );
}
