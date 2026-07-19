"use client";

import { ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { ObjectiveSection } from "@/components/bilan/objective-section";
import { PicksSection } from "@/components/bilan/picks-section";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Toast } from "@/components/ui/toast";
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
 * Rhabillage refonte #71 : score en héros dégradé, détail au barème en lignes
 * (+vert/−rouge), CTA « Copier » dégradé + toast — tout aux tokens.
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

/** « × 3 pts », « × 0,5 pt », « × −1 pt » — le barème par unité, virgule française. */
function formatUnitPoints(value: number): string {
  const absolute = Math.abs(value);
  const text = String(absolute).replace(".", ",");
  const sign = value < 0 ? "−" : "";
  return `× ${sign}${text} ${absolute >= 2 ? "pts" : "pt"}`;
}

/** Le libellé de section (design-specs §2 « Typographie ») : 12px 800 majuscule, `--ink3`. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2.5 text-xs font-extrabold uppercase tracking-[0.1em] text-ink3">{children}</h3>;
}

/**
 * Une ligne du détail au barème : libellé + sous-texte « × N pts », points à
 * droite en vert (+) / rouge (−), alignés `tabular-nums`. Les points viennent
 * TOUJOURS du moteur — jamais recopiés en dur (règle repo).
 */
function DetailRow({
  label,
  unit,
  points,
  isFirst,
}: {
  label: string;
  unit: string;
  points: number;
  isFirst?: boolean;
}) {
  const tone = points > 0 ? "text-green" : points < 0 ? "text-red" : "text-ink2";
  return (
    <div className={`flex items-baseline justify-between gap-3 py-2.5 text-[14.5px] ${isFirst ? "" : "border-t border-line"}`}>
      <span className="text-ink">
        {label}
        <span className="ml-1.5 text-[12.5px] text-ink3">{unit}</span>
      </span>
      <span className={`shrink-0 font-extrabold tabular-nums ${tone}`}>{formatPoints(points)}</span>
    </div>
  );
}

export function MonthlyReportView({ readings, purchases, objectivesByMonth, picks }: MonthlyReportViewProps) {
  const currentMonth = localCurrentMonth();
  const [month, setMonth] = useState(currentMonth);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
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
      setCopyFallbackText(null);
      setToastMessage("Bilan copié pour l'antenne ✓");
    } catch {
      setCopyFallbackText(reportToText(report, pickLines));
    }
  }

  const unreadCount = report.unreadPurchaseCount;
  // « pt » sous 2, « pts » à partir de 2 — 0 et 1 restent singuliers en français.
  const heroUnit = Math.abs(report.total) >= 2 ? "pts" : "pt";

  return (
    <div className="mt-4 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMonth(addMonths(month, -1))}
          aria-label="Mois précédent"
          className="grid size-11 place-items-center rounded-xl border border-line bg-card text-ink2 transition active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
        >
          <ChevronLeft aria-hidden className="size-5" />
        </button>
        <h2 className="text-[17px] font-extrabold capitalize text-ink">{formatMonthFrench(month)}</h2>
        <button
          type="button"
          onClick={() => setMonth(addMonths(month, 1))}
          disabled={month >= currentMonth}
          aria-label="Mois suivant"
          className="grid size-11 place-items-center rounded-xl border border-line bg-card text-ink2 transition active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan disabled:opacity-30 disabled:active:scale-100"
        >
          <ChevronRight aria-hidden className="size-5" />
        </button>
      </div>

      {/* Le score en héros (design-specs §5) : 52px 900 italique, dégradé signature. */}
      <Card className="py-6 text-center">
        <div className="bg-grad bg-clip-text text-[52px] font-black italic leading-none text-transparent">
          {formatPoints(report.total)} {heroUnit}
        </div>
        <div className="mt-2 text-xs font-bold uppercase tracking-[0.12em] text-ink3">Score du mois</div>
      </Card>

      <div>
        <SectionLabel>Le détail</SectionLabel>
        <Card className="flex flex-col">
          {categoryLines.length === 0 && (
            <p className="py-1 text-sm text-ink2">Aucune lecture terminée ce mois-ci.</p>
          )}
          {categoryLines.map(([category, count], index) => (
            <DetailRow
              key={category}
              isFirst={index === 0}
              label={`${count} ${CATEGORY_LABELS[category]}`}
              unit={formatUnitPoints(SCORING_SCALE.pointsByCategory[category])}
              points={count * SCORING_SCALE.pointsByCategory[category]}
            />
          ))}
          <DetailRow
            isFirst={categoryLines.length === 0}
            label={`${unreadCount} achat${unreadCount > 1 ? "s" : ""} non lu${unreadCount > 1 ? "s" : ""}`}
            unit={formatUnitPoints(SCORING_SCALE.unreadPurchasePenalty)}
            points={report.purchasePenalty}
          />
          {report.objective && (
            <DetailRow
              label={`Objectif ${
                report.objective.achieved ? "atteint 🎯" : month === currentMonth ? "en cours" : "manqué"
              }`}
              unit=""
              points={report.objective.bonus}
            />
          )}
        </Card>
      </div>

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

      {/* Le geste-livrable (design-specs §5) : CTA dégradé pleine largeur + toast. */}
      <Button variant="grad" block onClick={copyReport} className="mt-1">
        <Copy aria-hidden className="size-5" />
        Copier pour l&apos;antenne
      </Button>

      {copyFallbackText && (
        <div className="flex flex-col gap-1.5">
          <p role="alert" className="text-sm text-ink2">
            La copie automatique a été bloquée — sélectionne le texte ci-dessous :
          </p>
          <textarea
            readOnly
            value={copyFallbackText}
            rows={copyFallbackText.split("\n").length}
            onFocus={(event) => event.target.select()}
            className="rounded-xl border border-line bg-card2 p-3 font-mono text-sm text-ink"
          />
        </div>
      )}

      <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </div>
  );
}
