"use client";

import { Check, ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { ObjectiveSection } from "@/components/bilan/objective-section";
import { PicksSection } from "@/components/bilan/picks-section";
import { CATEGORY_LABELS } from "@/lib/books/categories";
import { ALL_PICK_KINDS, type PickKind } from "@/lib/books/pick-kinds";
import { addMonths, formatMonthFrench, localCurrentMonth } from "@/lib/dates";
import { computeMonthlyReport } from "@/lib/scoring/monthly-report";
import { formatPoints, reportToText, type PickLine } from "@/lib/scoring/report-text";
import { SCORING_SCALE } from "@/lib/scoring/scale";
import type { BookCategory, MonthlyObjective, PurchaseFact, ReadingFact } from "@/lib/scoring/types";

/**
 * La vue du bilan — le décompte par catégorie, les achats non lus, l'objectif
 * (§4.11), les distinctions (§4.4), le total, et le bouton copier : un texte
 * propre, lisible tel quel à l'antenne (specs §4.5). Consultable pour
 * n'importe quel mois passé.
 * Le texte copiable vit dans lib/scoring/report-text.ts (pur, testé).
 */

/** Une lecture du bilan : le fait du moteur + de quoi nommer une distinction. */
export type BilanReading = ReadingFact & {
  readingId: string;
  title: string;
};

/** Une distinction telle que la page la charge (mois en `YYYY-MM`). */
export type MonthlyPickRecord = {
  month: string;
  kind: PickKind;
  readingId: string;
  comment: string | null;
};

type MonthlyReportViewProps = {
  readings: BilanReading[];
  purchases: PurchaseFact[];
  objectivesByMonth: Record<string, MonthlyObjective>;
  picks: MonthlyPickRecord[];
};

export function MonthlyReportView({ readings, purchases, objectivesByMonth, picks }: MonthlyReportViewProps) {
  const currentMonth = localCurrentMonth();
  const [month, setMonth] = useState(currentMonth);
  const [isCopied, setIsCopied] = useState(false);
  const [copyFallbackText, setCopyFallbackText] = useState<string | null>(null);

  const objective = objectivesByMonth[month] ?? null;
  const report = useMemo(
    () => computeMonthlyReport(month, { readings, purchases, objective }),
    [month, readings, purchases, objective],
  );

  const categoryLines = (Object.entries(report.finishedByCategory) as [BookCategory, number][]).filter(
    ([, count]) => count > 0,
  );

  // Les candidates aux distinctions : les lectures TERMINÉES du mois affiché.
  const finishedReadingsOfMonth = useMemo(
    () =>
      readings
        .filter((reading) => reading.finishedAt !== null && reading.finishedAt.slice(0, 7) === month)
        .map((reading) => ({ readingId: reading.readingId, title: reading.title }))
        .sort((left, right) => left.title.localeCompare(right.title)),
    [readings, month],
  );
  const monthPicks = useMemo(() => picks.filter((pick) => pick.month === month), [picks, month]);

  // Les distinctions du texte copiable, dans l'ordre éditorial. Une lecture
  // devenue introuvable (supprimée depuis) est passée sous silence dans le
  // texte — pas de « (lecture introuvable) » à l'antenne.
  const pickLines: PickLine[] = useMemo(
    () =>
      ALL_PICK_KINDS.flatMap((kind) => {
        const pick = monthPicks.find((candidate) => candidate.kind === kind);
        if (!pick) return [];
        const reading = readings.find((candidate) => candidate.readingId === pick.readingId);
        if (!reading) return [];
        return [{ kind, title: reading.title, comment: pick.comment }];
      }),
    [monthPicks, readings],
  );

  async function copyReport() {
    // Le presse-papiers peut rejeter (permission, focus, navigateur) : pour LE
    // bouton du livrable, un échec muet est interdit — le texte s'affiche alors
    // dans une zone sélectionnable, toujours récupérable.
    try {
      await navigator.clipboard.writeText(reportToText(report, pickLines));
      setIsCopied(true);
      setCopyFallbackText(null);
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      setCopyFallbackText(reportToText(report, pickLines));
    }
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
        {report.objective && (
          <div className="flex items-baseline justify-between border-b border-foreground/10 px-4 py-3">
            <span>
              Objectif du mois <span className="opacity-60">{report.objective.achieved ? "atteint" : month === currentMonth ? "en cours" : "manqué"}</span>
            </span>
            <span className="font-mono text-sm">{formatPoints(report.objective.bonus)}</span>
          </div>
        )}
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

      {copyFallbackText && (
        <div className="flex flex-col gap-1.5">
          <p role="alert" className="text-sm opacity-80">
            La copie automatique a été bloquée — sélectionne le texte ci-dessous :
          </p>
          <textarea
            readOnly
            value={copyFallbackText}
            rows={copyFallbackText.split("\n").length}
            onFocus={(event) => event.target.select()}
            className="rounded-md border border-foreground/20 bg-transparent p-3 font-mono text-sm"
          />
        </div>
      )}

      <ObjectiveSection
        // La clé remet l'éditeur à zéro quand on change de mois : le brouillon
        // d'un mois ne fuit pas sur l'autre.
        key={`objective-${month}`}
        month={month}
        isCurrentMonth={month === currentMonth}
        objective={objective}
        progress={report.objective}
      />

      <PicksSection key={`picks-${month}`} month={month} finishedReadings={finishedReadingsOfMonth} picks={monthPicks} />
    </div>
  );
}
