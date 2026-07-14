"use client";

import { Check, ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { CATEGORY_LABELS } from "@/lib/books/categories";
import { addMonths, formatMonthFrench, localCurrentMonth } from "@/lib/dates";
import { computeMonthlyReport } from "@/lib/scoring/monthly-report";
import { SCORING_SCALE } from "@/lib/scoring/scale";
import type { BookCategory, MonthlyReport, PurchaseFact, ReadingFact } from "@/lib/scoring/types";

/**
 * La vue du bilan — le décompte par catégorie, les achats non lus, le total,
 * et le bouton copier : un texte propre, lisible tel quel à l'antenne
 * (specs §4.5). Consultable pour n'importe quel mois passé.
 */

type MonthlyReportViewProps = {
  readings: ReadingFact[];
  purchases: PurchaseFact[];
};

/** +7,5 / −2 / 0 — les demi-points existent, la virgule est française. */
const formatPoints = (points: number): string => {
  const text = String(Math.abs(points)).replace(".", ",");
  if (points > 0) return `+${text}`;
  if (points < 0) return `−${text}`;
  return "0";
};

/** Le texte à lire à l'antenne — copiable en un tap. */
function reportToText(report: MonthlyReport): string {
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
  return lines.join("\n");
}

export function MonthlyReportView({ readings, purchases }: MonthlyReportViewProps) {
  const currentMonth = localCurrentMonth();
  const [month, setMonth] = useState(currentMonth);
  const [isCopied, setIsCopied] = useState(false);

  const report = useMemo(
    () => computeMonthlyReport(month, { readings, purchases }),
    [month, readings, purchases],
  );

  const categoryLines = (Object.entries(report.finishedByCategory) as [BookCategory, number][]).filter(
    ([, count]) => count > 0,
  );

  async function copyReport() {
    await navigator.clipboard.writeText(reportToText(report));
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  }

  return (
    <div className="mt-4 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMonth(addMonths(month, -1))}
          aria-label="Mois précédent"
          className="rounded-full border border-foreground/20 p-2"
        >
          <ChevronLeft aria-hidden className="size-5" />
        </button>
        <h2 className="text-lg font-semibold capitalize">{formatMonthFrench(month)}</h2>
        <button
          type="button"
          onClick={() => setMonth(addMonths(month, 1))}
          disabled={month >= currentMonth}
          aria-label="Mois suivant"
          className="rounded-full border border-foreground/20 p-2 disabled:opacity-30"
        >
          <ChevronRight aria-hidden className="size-5" />
        </button>
      </div>

      <div className="rounded-xl border border-foreground/10">
        {categoryLines.length === 0 ? (
          <p className="px-4 py-5 text-sm opacity-70">Aucune lecture terminée ce mois-ci.</p>
        ) : (
          <ul>
            {categoryLines.map(([category, count]) => (
              <li key={category} className="flex items-baseline justify-between border-b border-foreground/10 px-4 py-3">
                <span>
                  {CATEGORY_LABELS[category]} <span className="opacity-60">× {count}</span>
                </span>
                <span className="font-mono text-sm">{formatPoints(count * SCORING_SCALE.pointsByCategory[category])}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-baseline justify-between border-b border-foreground/10 px-4 py-3">
          <span>
            Achats non lus <span className="opacity-60">× {report.unreadPurchaseCount}</span>
          </span>
          <span className="font-mono text-sm">{formatPoints(report.purchasePenalty)}</span>
        </div>
        <div className="flex items-baseline justify-between px-4 py-4">
          <span className="text-lg font-bold">Score du mois</span>
          <span className={`font-mono text-2xl font-bold ${report.total >= 0 ? "text-amber-500" : "text-red-500"}`}>
            {formatPoints(report.total)}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={copyReport}
        className="flex items-center justify-center gap-2 rounded-full border-2 border-amber-500 px-6 py-3 font-semibold text-amber-500"
      >
        {isCopied ? <Check aria-hidden className="size-5" /> : <Copy aria-hidden className="size-5" />}
        {isCopied ? "Copié !" : "Copier pour l'antenne"}
      </button>
    </div>
  );
}
