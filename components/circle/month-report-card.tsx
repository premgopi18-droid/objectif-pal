import { Badge } from "@/components/ui/badge";
import { CATEGORY_LABELS } from "@/lib/books/categories";
import { ALL_PICK_KINDS, PICK_KIND_BADGE_STATE, PICK_KIND_LABELS } from "@/lib/books/pick-kinds";
import type { ParticipantPick } from "@/lib/circle/report-queries";
import type { StoredMonthlyReport } from "@/lib/scoring/closed-months";
import { formatPoints, formatPointsLabel } from "@/lib/scoring/report-text";
import { SCORING_SCALE } from "@/lib/scoring/scale";
import type { BookCategory } from "@/lib/scoring/types";
import { ALL_CATEGORIES } from "@/lib/scoring/types";

/**
 * Le bilan d'UN mois clos d'UN membre du cercle (§4.14, lot B) — purement
 * présentatiel, rendu depuis la ligne d'agrégat telle quelle (le contenu
 * exact de « ce qu'un ami voit » : score, détail, jauges, distinctions,
 * titres — jamais notes ni avis, ils ne sont pas dans la ligne).
 *
 * Le titre d'une distinction se résout via `finishedReadings` : la lecture
 * distinguée est une terminée du même mois. Introuvable (édition rétroactive
 * entre deux calculs) → le libellé s'affiche seul, rien n'est inventé.
 */

type MonthReportCardProps = {
  stored: StoredMonthlyReport;
  picks: ParticipantPick[];
};


export function MonthReportCard({ stored, picks }: MonthReportCardProps) {
  const { report, finishedReadings } = stored;
  const categoryLines = ALL_CATEGORIES.map((category) => [category, report.finishedByCategory[category]] as const).filter(
    ([, count]) => count > 0,
  );
  const orderedPicks = ALL_PICK_KINDS.flatMap((kind) => {
    const pick = picks.find((candidate) => candidate.kind === kind);
    if (pick === undefined) return [];
    const title = finishedReadings.find((reading) => reading.readingId === pick.readingId)?.title ?? null;
    return [{ kind, title }];
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-bold uppercase tracking-[0.12em] text-ink3">Score du mois</span>
        <span className="bg-grad bg-clip-text text-[26px] font-black italic leading-none text-transparent">
          {formatPointsLabel(report.total)}
        </span>
      </div>

      <div className="flex flex-col gap-1 text-sm">
        {categoryLines.length === 0 && <p className="text-ink3">Aucune lecture terminée ce mois-là.</p>}
        {categoryLines.map(([category, count]) => (
          <DetailLine
            key={category}
            label={`${count} ${CATEGORY_LABELS[category as BookCategory]}`}
            points={formatPoints(count * SCORING_SCALE.pointsByCategory[category as BookCategory])}
          />
        ))}
        {report.unreadPurchaseCount > 0 && (
          <DetailLine
            label={`${report.unreadPurchaseCount} achat${report.unreadPurchaseCount > 1 ? "s" : ""} non lu${report.unreadPurchaseCount > 1 ? "s" : ""}`}
            points={formatPoints(report.purchasePenalty)}
            negative
          />
        )}
        {report.objective !== null && (
          <>
            {report.objective.progress.map((line) => (
              <DetailLine
                key={line.category}
                label={`Objectif ${CATEGORY_LABELS[line.category]} : ${line.finished}/${line.target}`}
              />
            ))}
            <DetailLine
              label={report.objective.achieved ? "Objectif du mois atteint" : "Objectif du mois manqué"}
              points={report.objective.achieved ? formatPoints(report.objective.bonus) : undefined}
            />
          </>
        )}
      </div>

      {orderedPicks.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {orderedPicks.map(({ kind, title }) => (
            <div key={kind} className="flex items-center gap-2">
              <Badge state={PICK_KIND_BADGE_STATE[kind]}>{PICK_KIND_LABELS[kind]}</Badge>
              {title !== null && <span className="min-w-0 truncate text-sm text-ink2">{title}</span>}
            </div>
          ))}
        </div>
      )}

      {finishedReadings.length > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-ink3">Terminés ce mois-là</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-sm text-ink2">
            {finishedReadings.map((reading) => (
              <li key={reading.readingId} className="truncate">
                {reading.title}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function DetailLine({ label, points, negative = false }: { label: string; points?: string; negative?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="min-w-0 truncate text-ink2">{label}</span>
      {points !== undefined && (
        <span className={`shrink-0 font-bold ${negative ? "text-red" : "text-green"}`}>{points}</span>
      )}
    </div>
  );
}
