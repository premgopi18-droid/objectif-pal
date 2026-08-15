import { ALL_PICK_KINDS, type PickKind } from "@/lib/books/pick-kinds";
import type { StoredMonthlyReport } from "@/lib/scoring/closed-months";
import type { Month } from "@/lib/scoring/types";

/**
 * La carte de paliste (specs §4.14, lot C — issue #230) : l'identité de jeu
 * d'un compte, dérivée des SEULS agrégats — zéro recalcul du moteur, zéro
 * donnée nouvelle. Le même module sert MA carte (page Profil) et celle d'un
 * AMI (fiche du cercle) : l'« aperçu honnête » est garanti par construction.
 *
 * Règles (décisions du 15/08/2026, reportées en spec) :
 *  - uniquement les MOIS CLOS — les agrégats n'en contiennent pas d'autres,
 *    et les distinctions reçues sont filtrées `< currentMonth` (mes propres
 *    picks incluent le mois courant : la carte ne spoile pas le reveal) ;
 *  - `yearTotal` = somme des mois clos de l'année civile de `currentMonth` —
 *    zéro si l'année n'a encore aucun mois clos (janvier : c'est normal, et
 *    affiché comme tel) ;
 *  - `bestMonth` = le meilleur score ; à ÉGALITÉ, le plus récent (la forme du
 *    moment bat le souvenir) ;
 *  - `readingCount` = le cumul des terminées des lignes d'agrégat.
 */

export type PalisteCard = {
  /** Le cumul par type de distinction, tous mois clos confondus. */
  distinctionCounts: Record<PickKind, number>;
  /** Le meilleur mois clos — `null` tant qu'aucun mois n'est clos. */
  bestMonth: { month: Month; total: number } | null;
  /** L'année civile du cumul (`YYYY`) — celle de `currentMonth`. */
  year: string;
  /** La somme des scores des mois clos de l'année — 0 si aucun. */
  yearTotal: number;
  /** Les lectures terminées, tous mois clos confondus. */
  readingCount: number;
};

export function derivePalisteCard(
  storedReports: StoredMonthlyReport[],
  picks: { month: Month; kind: PickKind }[],
  currentMonth: Month,
): PalisteCard {
  const year = currentMonth.slice(0, 4);

  const distinctionCounts = Object.fromEntries(ALL_PICK_KINDS.map((kind) => [kind, 0])) as Record<
    PickKind,
    number
  >;
  for (const pick of picks) {
    if (pick.month < currentMonth) distinctionCounts[pick.kind] += 1;
  }

  let bestMonth: PalisteCard["bestMonth"] = null;
  let yearTotal = 0;
  let readingCount = 0;
  for (const { report, finishedReadings } of storedReports) {
    readingCount += finishedReadings.length;
    if (report.month.slice(0, 4) === year) yearTotal += report.total;
    // `>=` sur un parcours par mois croissant donnerait le plus récent, mais
    // l'ordre d'entrée n'est pas garanti : la comparaison est explicite.
    if (
      bestMonth === null ||
      report.total > bestMonth.total ||
      (report.total === bestMonth.total && report.month > bestMonth.month)
    ) {
      bestMonth = { month: report.month, total: report.total };
    }
  }

  return { distinctionCounts, bestMonth, year, yearTotal, readingCount };
}
