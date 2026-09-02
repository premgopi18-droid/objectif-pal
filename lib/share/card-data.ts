import { formatMonthFrench } from "@/lib/dates";
import { formatPoints } from "@/lib/scoring/report-text";
import { ALL_CATEGORIES, type MonthlyReport } from "@/lib/scoring/types";

/**
 * La carte de partage — dérivation PURE des données à dessiner (specs §4.15,
 * issue #263) : un `MonthlyReport` déjà calculé + un pseudo → exactement ce
 * que le moteur de rendu écrit sur le fond. Aucun accès base, aucune horloge,
 * zéro barème recopié (`formatPoints` et l'ordre `ALL_CATEGORIES` sont LA
 * source) — testable comme le moteur de scoring.
 *
 * Version LIVE seulement : ni distinctions ni suspense — le reveal appartient
 * à l'antenne (§4.15).
 */

/** Une cellule d'objectif — null quand la catégorie n'a pas de cible (« — »). */
export type ShareObjectiveCell = {
  finished: number;
  target: number;
  /** Remplissage de la jauge, PLAFONNÉ à 1 : 7/6 remplit la barre, sans déborder. */
  ratio: number;
} | null;

export type ShareCardData = {
  /** Le pseudo, en capitales (les fonds parlent en capitales). */
  name: string;
  /** « AOÛT 2026 » — la date pilotée par le moteur, jamais cuite dans le fond. */
  monthLabel: string;
  /** « +48,5 », « −1 », « 0 » — virgule française, signe typographique. */
  score: string;
  /** 6 cellules dans l'ordre des fonds (= `ALL_CATEGORIES`) : gauche Issue/Manga/BD, droite Comics/Omnibus/Roman. */
  objectives: ShareObjectiveCell[];
  /** 7 compteurs : les 6 catégories puis « Titre acheté non lu ». */
  counts: number[];
};

export function deriveShareCardData(report: MonthlyReport, displayName: string): ShareCardData {
  const targetByCategory = new Map(report.objective?.progress.map((line) => [line.category, line]) ?? []);
  return {
    name: displayName.toLocaleUpperCase("fr-FR"),
    monthLabel: formatMonthFrench(report.month).toLocaleUpperCase("fr-FR"),
    score: formatPoints(report.total),
    objectives: ALL_CATEGORIES.map((category) => {
      const line = targetByCategory.get(category);
      // Jamais de cible à 0 en base (`objective_targets`) — le garde-fou reste.
      if (line === undefined || line.target <= 0) return null;
      return { finished: line.finished, target: line.target, ratio: Math.min(1, line.finished / line.target) };
    }),
    counts: [...ALL_CATEGORIES.map((category) => report.finishedByCategory[category]), report.unreadPurchaseCount],
  };
}

/** Le libellé d'une cellule d'objectif : « 37 / 50 », ou « — » sans cible. */
export const formatObjectiveCell = (cell: ShareObjectiveCell): string =>
  cell === null ? "—" : `${cell.finished} / ${cell.target}`;
