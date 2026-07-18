import { CATEGORY_LABELS } from "@/lib/books/categories";
import { PICK_KIND_LABELS, type PickKind } from "@/lib/books/pick-kinds";
import { formatMonthFrench } from "@/lib/dates";
import { SCORING_SCALE } from "@/lib/scoring/scale";
import type { BookCategory, MonthlyReport } from "@/lib/scoring/types";

/**
 * Le bilan en TEXTE — ce que le bouton « Copier pour l'antenne » met dans le
 * presse-papiers (specs §4.5). Pure transformation d'un `MonthlyReport` déjà
 * calculé : aucune donnée, aucune horloge — testable comme le moteur.
 */

/** Une distinction prête pour le texte : le libellé vient de son `kind`. */
export type PickLine = {
  kind: PickKind;
  title: string;
  comment: string | null;
};

/** +7,5 / −2 / 0 — les demi-points existent, la virgule est française. */
export const formatPoints = (points: number): string => {
  const text = String(Math.abs(points)).replace(".", ",");
  if (points > 0) return `+${text}`;
  if (points < 0) return `−${text}`;
  return "0";
};

/**
 * Le texte à lire à l'antenne — copiable en un tap. Les distinctions du mois
 * s'ajoutent après le score (décision du 18/07/2026, specs §4.4) : ce qu'on
 * lit à l'antenne n'est pas qu'un décompte. L'appelant les fournit déjà
 * ordonnées (ALL_PICK_KINDS) — la fonction reste pure.
 */
export function reportToText(report: MonthlyReport, picks: PickLine[] = []): string {
  const lines: string[] = [`Objectif PAL — bilan de ${formatMonthFrench(report.month)}`];
  for (const [category, count] of Object.entries(report.finishedByCategory) as [BookCategory, number][]) {
    if (count === 0) continue;
    const points = count * SCORING_SCALE.pointsByCategory[category];
    lines.push(`${CATEGORY_LABELS[category]} : ${count} (${formatPoints(points)})`);
  }
  if (report.readingPoints === 0) lines.push("Aucune lecture terminée ce mois-ci.");
  lines.push(`Achats non lus : ${report.unreadPurchaseCount} (${formatPoints(report.purchasePenalty)})`);
  if (report.objective) {
    lines.push(`Objectif du mois : ${report.objective.achieved ? `atteint (${formatPoints(report.objective.bonus)})` : "manqué"}`);
  }
  lines.push(`Score du mois : ${formatPoints(report.total)}`);
  for (const pick of picks) {
    lines.push(`${PICK_KIND_LABELS[pick.kind]} : ${pick.title}${pick.comment ? ` — ${pick.comment}` : ""}`);
  }
  return lines.join("\n");
}
