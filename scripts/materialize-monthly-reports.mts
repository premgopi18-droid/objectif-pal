/**
 * La matérialisation mensuelle des agrégats de mois clos (§4.14 lot B, #229).
 *
 * Pourquoi : les lignes `monthly_reports` sont entretenues par la page Bilan
 * du PROPRIÉTAIRE (#214) — sans filet, le bilan d'août d'un ami n'existe le
 * 1er septembre que s'il a rouvert son Bilan depuis. Ce job passe le 1er du
 * mois (workflow `monthly-reports.yml`) et matérialise les mois clos de TOUS
 * les comptes : le rendez-vous des bilans comparés est fiable.
 *
 * Zéro barème dupliqué : le script est en TypeScript (lancé via `tsx`)
 * précisément pour réutiliser `syncMonthlyReports` — le même code que la
 * page Bilan, freshness comprise (un compte à jour = une lecture de version,
 * zéro écriture). Idempotent et relançable à volonté.
 *
 * Le « mois courant » est UTC — la même convention que la synchro de la page
 * (#214) : à 04:00 UTC le 1er, le mois précédent vient de se clore partout
 * en Europe ; la frontière pour d'autres fuseaux est assumée sans enjeu (la
 * visite suivante du propriétaire recale tout).
 *
 * ⚠️ Service role : la RLS ne protège pas ce script — CHAQUE requête filtre
 * `user_id` explicitement (la règle maison des scripts de prod).
 *
 * Usage :
 *   npx tsx scripts/materialize-monthly-reports.mts           → matérialisation réelle
 *   npx tsx scripts/materialize-monthly-reports.mts --dry-run → état de fraîcheur, zéro écriture
 *
 * Env : NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (environnement,
 * ou .env.local en local — patron maintenance-purge.mjs).
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { readFactVersion, syncMonthlyReports } from "@/lib/bilan/report-sync";
import { listClosedActivityMonths, type BilanReadingFact } from "@/lib/scoring/closed-months";
import type { MonthlyObjective, PurchaseFact } from "@/lib/scoring/types";
import { fetchAllRows } from "@/lib/supabase/pagination";
import type { Database } from "@/lib/supabase/database.types";

const isDryRun = process.argv.includes("--dry-run");

// En local, .env.local complète l'environnement (jamais l'inverse).
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq < 1 || line.startsWith("#")) continue;
    const key = line.slice(0, eq).trim();
    if (!process.env[key]) process.env[key] = line.slice(eq + 1).trim();
  }
} catch {
  // Pas de .env.local (CI) : l'environnement doit suffire.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.");
  process.exit(1);
}

const supabase = createClient<Database>(url, serviceRoleKey, { auth: { persistSession: false } });
const currentMonth = new Date().toISOString().slice(0, 7);

/** Les faits d'UN compte — les mêmes requêtes que la page Bilan, filtrées user_id (service role !). */
async function loadFacts(userId: string) {
  const [readingsRows, purchasesRows, objectivesResult] = await Promise.all([
    fetchAllRows(async (from, to) => {
      const { data, error } = await supabase
        .from("readings")
        .select("id, book_id, status, started_at, finished_at, book:books!inner (title, category, deleted_at)")
        .eq("user_id", userId)
        .eq("status", "finished")
        .is("deleted_at", null)
        .is("book.deleted_at", null)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) throw new Error(error.message);
      return data ?? [];
    }),
    fetchAllRows(async (from, to) => {
      const { data, error } = await supabase
        .from("purchases")
        .select("id, book_id, purchased_at, book:books!inner (deleted_at)")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .is("book.deleted_at", null)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) throw new Error(error.message);
      return data ?? [];
    }),
    supabase
      .from("monthly_objectives")
      .select("month, objective_targets (category, target_count)")
      .eq("user_id", userId),
  ]);
  if (objectivesResult.error) throw new Error(objectivesResult.error.message);

  const readings: BilanReadingFact[] = readingsRows.map((row) => ({
    readingId: row.id,
    title: row.book.title,
    bookId: row.book_id,
    category: row.book.category,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }));
  const purchases: PurchaseFact[] = purchasesRows.map((row) => ({
    bookId: row.book_id,
    purchasedAt: row.purchased_at,
  }));
  const objectivesByMonth: Record<string, MonthlyObjective> = Object.fromEntries(
    (objectivesResult.data ?? []).map((row) => [
      row.month.slice(0, 7),
      Object.fromEntries(row.objective_targets.map((target) => [target.category, target.target_count])),
    ]),
  );
  return { readings, purchases, objectivesByMonth };
}

const { data: profiles, error: profilesError } = await supabase.from("profiles").select("id, display_name");
if (profilesError) {
  console.error("Lecture des profils impossible :", profilesError.message);
  process.exit(1);
}

console.log(
  `Matérialisation des mois clos — ${profiles.length} compte(s), mois courant ${currentMonth} (UTC)${isDryRun ? ", DRY-RUN" : ""}`,
);

let fresh = 0;
let updated = 0;
let failed = 0;

/** La comparaison de fraîcheur — la même que la synchro, utilisée avant ET après (review #232). */
async function readFreshness(userId: string, closedMonths: string[], factVersion: number): Promise<boolean> {
  const { data: storedRows, error } = await supabase
    .from("monthly_reports")
    .select("month, fact_version")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  const storedByMonth = new Map((storedRows ?? []).map((row) => [row.month.slice(0, 7), row.fact_version]));
  return (
    closedMonths.every((month) => storedByMonth.get(month) === factVersion) &&
    (storedRows ?? []).every((row) => closedMonths.includes(row.month.slice(0, 7)))
  );
}

for (const profile of profiles) {
  try {
    // L'ordre anti-course de la review #214 : la version AVANT les faits.
    const factVersion = await readFactVersion(supabase, profile.id);
    const facts = await loadFacts(profile.id);
    const closedMonths = listClosedActivityMonths(facts, currentMonth);

    if (await readFreshness(profile.id, closedMonths, factVersion)) {
      fresh += 1;
      console.log(`  ✓ ${profile.display_name} — frais (${closedMonths.length} mois clos)`);
      continue;
    }
    if (isDryRun) {
      updated += 1;
      console.log(`  → ${profile.display_name} — À RECALCULER (${closedMonths.length} mois clos, version ${factVersion})`);
      continue;
    }
    // La même synchro que la page Bilan — elle refait sa propre lecture des
    // lignes (freshness incluse) : le travail en double est négligeable, la
    // logique reste UNIQUE. Elle logge ses échecs SANS JETER (contrat « jamais
    // bloquante », pensé pour la page) — d'où la re-vérification juste après
    // (review #232) : un échec interne laisserait sinon le job en faux vert,
    // le pire mode de panne d'un job de fiabilité.
    await syncMonthlyReports(supabase, profile.id, currentMonth, factVersion, facts);
    if (!(await readFreshness(profile.id, closedMonths, factVersion))) {
      // Nuance assumée : une édition utilisateur GLISSÉE pendant la synchro
      // (version bumpée entre-temps) compterait ici en échec — improbable à
      // 04:00 le 1er, et un faux rouge se relance, un faux vert se rate.
      throw new Error("toujours périmé après synchro — voir le log [bilan] ci-dessus");
    }
    updated += 1;
    console.log(`  ✓ ${profile.display_name} — recalculé (${closedMonths.length} mois clos)`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${profile.display_name} —`, error instanceof Error ? error.message : String(error));
  }
}

console.log(`Terminé : ${fresh} frais, ${updated} ${isDryRun ? "à recalculer" : "recalculés"}, ${failed} échec(s).`);
if (failed > 0) process.exit(1);
