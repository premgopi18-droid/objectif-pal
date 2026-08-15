import { ALL_CATEGORIES } from "@/lib/scoring/types";
import type { StoredMonthlyReport } from "@/lib/scoring/closed-months";

/**
 * Le parsing DÉFENSIF d'une ligne `monthly_reports` (specs §4.14, lot B).
 *
 * Les lignes sont recalculées à chaque changement de faits, mais un rapport
 * écrit par une VIEILLE version de l'app peut traîner (fenêtre entre un
 * déploiement et la prochaine visite du propriétaire). On ne fait jamais
 * confiance au jsonb : une ligne illisible est écartée proprement (l'UI
 * affiche « bilan indisponible »), jamais un crash ni un chiffre inventé.
 *
 * Volontairement TOLÉRANT sur ce qui ne casse rien (une catégorie inconnue
 * dans `finishedByCategory` est ignorée) et STRICT sur ce que l'UI affiche
 * en chiffres (total, points, malus, bonus : des nombres, sinon rien).
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function parseStoredMonthlyReport(value: unknown): StoredMonthlyReport | null {
  if (!isRecord(value) || !isRecord(value.report) || !Array.isArray(value.finishedReadings)) return null;
  const report = value.report;

  if (typeof report.month !== "string") return null;
  if (!isFiniteNumber(report.total) || !isFiniteNumber(report.readingPoints)) return null;
  if (!isFiniteNumber(report.unreadPurchaseCount) || !isFiniteNumber(report.purchasePenalty)) return null;
  if (!isRecord(report.finishedByCategory)) return null;

  // Les compteurs par catégorie : les six connues, à zéro par défaut — une
  // valeur non numérique invalide la ligne, une catégorie en trop est ignorée.
  const finishedByCategory = Object.fromEntries(ALL_CATEGORIES.map((category) => [category, 0])) as Record<
    (typeof ALL_CATEGORIES)[number],
    number
  >;
  for (const category of ALL_CATEGORIES) {
    const count = report.finishedByCategory[category];
    if (count === undefined) continue;
    if (!isFiniteNumber(count)) return null;
    finishedByCategory[category] = count;
  }

  // L'objectif : absent (null) ou complet — des jauges à moitié lisibles
  // mentiraient à l'antenne.
  let objective: StoredMonthlyReport["report"]["objective"] = null;
  if (report.objective !== null && report.objective !== undefined) {
    if (!isRecord(report.objective) || !Array.isArray(report.objective.progress)) return null;
    if (typeof report.objective.achieved !== "boolean" || !isFiniteNumber(report.objective.bonus)) return null;
    const progress = [];
    for (const line of report.objective.progress) {
      if (!isRecord(line)) return null;
      const category = ALL_CATEGORIES.find((known) => known === line.category);
      if (category === undefined || !isFiniteNumber(line.target) || !isFiniteNumber(line.finished)) return null;
      progress.push({ category, target: line.target, finished: line.finished });
    }
    objective = { progress, achieved: report.objective.achieved, bonus: report.objective.bonus };
  }

  const finishedReadings = [];
  for (const entry of value.finishedReadings) {
    if (!isRecord(entry) || typeof entry.readingId !== "string" || typeof entry.title !== "string") return null;
    finishedReadings.push({ readingId: entry.readingId, title: entry.title });
  }

  return {
    report: {
      month: report.month,
      finishedByCategory,
      readingPoints: report.readingPoints,
      unreadPurchaseCount: report.unreadPurchaseCount,
      purchasePenalty: report.purchasePenalty,
      objective,
      total: report.total,
    },
    finishedReadings,
  };
}
