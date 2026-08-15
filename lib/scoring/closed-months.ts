import { computeMonthlyReport } from "./monthly-report";
import type { Month, MonthlyObjective, MonthlyReport, PurchaseFact, ReadingFact } from "./types";

/**
 * Les mois clos matérialisables (epic #182 — le socle de §4.14 Amis).
 *
 * Fonctions PURES : quels mois d'activité sont clos, et quoi ranger dans la
 * ligne d'agrégat de chacun. Le moteur (`computeMonthlyReport`) reste l'unique
 * source du barème — ici on ne fait que l'appeler mois par mois et emballer
 * son résultat avec les terminées du mois (titres : les candidates aux
 * distinctions et la matière du texte d'antenne).
 *
 * « Clos » = strictement antérieur au mois courant (§4.14 : l'app ne spoile
 * jamais le reveal — le mois en cours n'a PAS de ligne, il n'y a rien à
 * montrer). La stabilité vient du barème lui-même : « une lecture terminée un
 * mois SUIVANT n'efface rien » — seule une édition rétroactive change un mois
 * clos, et le versionnage des faits s'en charge.
 */

/** Une lecture du bilan avec de quoi nommer une distinction. */
export type BilanReadingFact = ReadingFact & { readingId: string; title: string };

/** Ce qu'une ligne d'agrégat stocke pour UN mois clos. */
export type StoredMonthlyReport = {
  report: MonthlyReport;
  /** Les terminées du mois, triées par titre — mêmes règles que la vue Bilan. */
  finishedReadings: { readingId: string; title: string }[];
};

/**
 * Les mois d'activité STRICTEMENT antérieurs au mois courant — ceux qui
 * méritent une ligne. Un mois compte s'il a une fin de lecture, un achat ou
 * un objectif : le moteur peut y produire autre chose que du vide.
 */
export function listClosedActivityMonths(
  facts: { readings: BilanReadingFact[]; purchases: PurchaseFact[]; objectivesByMonth: Record<string, MonthlyObjective> },
  currentMonth: Month,
): Month[] {
  const months = new Set<Month>();
  for (const reading of facts.readings) {
    if (reading.status === "finished" && reading.finishedAt !== null) months.add(reading.finishedAt.slice(0, 7));
  }
  for (const purchase of facts.purchases) {
    months.add(purchase.purchasedAt.slice(0, 7));
  }
  for (const month of Object.keys(facts.objectivesByMonth)) {
    months.add(month);
  }
  return [...months].filter((month) => month < currentMonth).sort();
}

/** La ligne d'agrégat d'un mois — le moteur fait le score, on emballe. */
export function buildStoredMonthlyReport(
  month: Month,
  facts: { readings: BilanReadingFact[]; purchases: PurchaseFact[]; objectivesByMonth: Record<string, MonthlyObjective> },
): StoredMonthlyReport {
  const report = computeMonthlyReport(month, {
    readings: facts.readings,
    purchases: facts.purchases,
    objective: facts.objectivesByMonth[month] ?? null,
  });
  const finishedReadings = facts.readings
    .filter((reading) => reading.status === "finished" && reading.finishedAt !== null && reading.finishedAt.slice(0, 7) === month)
    .map((reading) => ({ readingId: reading.readingId, title: reading.title }))
    .sort((left, right) => left.title.localeCompare(right.title));
  return { report, finishedReadings };
}
