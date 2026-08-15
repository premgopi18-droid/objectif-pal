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

/**
 * Les métadonnées PUBLIQUES du livre embarquées dans la ligne d'agrégat
 * (#236) : ce qui rend une lecture identifiable par un ami — couverture,
 * série, auteurs, catégorie, éditeur, pages, ISBN. Des faits du livre, jamais
 * de l'utilisateur : ni note, ni avis, ni dates n'entrent ici.
 */
export type StoredBookInfo = {
  coverUrl: string | null;
  seriesName: string | null;
  authors: string | null;
  publisher: string | null;
  pageCount: number | null;
  isbn: string | null;
};

/** Une lecture du bilan : de quoi nommer une distinction ET identifier le livre (#236). */
export type BilanReadingFact = ReadingFact & { readingId: string; title: string; book: StoredBookInfo };

/**
 * Une terminée telle que la ligne d'agrégat la stocke — titre + métadonnées
 * publiques. La catégorie vient de la LECTURE (c'est la même donnée que celle
 * du livre — elle fait les points, §3 — pas de doublon dans la ligne).
 * Nullable À LA LECTURE : une ligne d'avant #236 n'en a pas — la tolérance du
 * parseur est le contrat de compatibilité.
 */
export type StoredFinishedReading = {
  readingId: string;
  title: string;
  category: ReadingFact["category"] | null;
} & StoredBookInfo;

/** Ce qu'une ligne d'agrégat stocke pour UN mois clos. */
export type StoredMonthlyReport = {
  report: MonthlyReport;
  /** Les terminées du mois, triées par titre — mêmes règles que la vue Bilan. */
  finishedReadings: StoredFinishedReading[];
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
    .map((reading) => ({ readingId: reading.readingId, title: reading.title, category: reading.category, ...reading.book }))
    .sort((left, right) => left.title.localeCompare(right.title));
  return { report, finishedReadings };
}
