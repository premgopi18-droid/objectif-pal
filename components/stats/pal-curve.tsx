"use client";

import { formatMonthFrench } from "@/lib/dates";
import type { Month } from "@/lib/scoring/types";

/**
 * La courbe cumulée de la pile — SVG inline, zéro dépendance de charting
 * (specs §10). Série unique : la couleur vient de l'accent de l'app
 * (currentColor), les textes restent en encre neutre. Axe du temps honnête :
 * l'appelant fournit des mois CONSÉCUTIFS (fillMonthGaps), jamais compressés.
 */

const WIDTH = 320;
const HEIGHT = 120;
const PADDING = { top: 16, right: 10, bottom: 20, left: 10 };
/** Au-delà, les points visibles deviennent du bruit — on ne garde que le dernier. */
const MAX_VISIBLE_DOTS = 18;

type PalCurveProps = {
  points: { month: Month; size: number }[];
};

export function PalCurve({ points }: PalCurveProps) {
  if (points.length === 0) {
    return <p className="text-sm opacity-70">La pile n&apos;a pas encore d&apos;historique.</p>;
  }

  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const maxSize = Math.max(1, ...points.map((point) => point.size));
  const x = (index: number) =>
    // Un seul point : centré, pas de division par zéro.
    points.length === 1 ? PADDING.left + plotWidth / 2 : PADDING.left + (index * plotWidth) / (points.length - 1);
  const y = (size: number) => PADDING.top + (1 - size / maxSize) * plotHeight;
  const baseline = y(0);

  const coordinates = points.map((point, index) => ({ ...point, x: x(index), y: y(point.size) }));
  const polyline = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `M ${coordinates[0].x},${baseline} L ${polyline.replaceAll(" ", " L ")} L ${coordinates.at(-1)!.x},${baseline} Z`;

  const first = points[0];
  const last = points.at(-1)!;
  const showAllDots = points.length <= MAX_VISIBLE_DOTS;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`Courbe de la pile : ${first.size} en ${formatMonthFrench(first.month)}, ${last.size} en ${formatMonthFrench(last.month)}.`}
      className="w-full text-amber-500"
    >
      {/* Repères discrets : la ligne de base et le plafond (max). */}
      <line x1={PADDING.left} y1={baseline} x2={WIDTH - PADDING.right} y2={baseline} className="stroke-foreground/15" />
      <line
        x1={PADDING.left}
        y1={y(maxSize)}
        x2={WIDTH - PADDING.right}
        y2={y(maxSize)}
        className="stroke-foreground/10"
        strokeDasharray="3 3"
      />

      {points.length > 1 && <path d={area} fill="currentColor" opacity={0.12} />}
      {points.length > 1 && (
        <polyline points={polyline} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
      )}

      {coordinates.map((point, index) => {
        const isLast = index === coordinates.length - 1;
        if (!showAllDots && !isLast) return null;
        return (
          // Cible tactile plus large que la marque : le cercle transparent porte
          // l'infobulle native, le petit point reste fin.
          <g key={point.month}>
            <circle cx={point.x} cy={point.y} r={10} fill="transparent">
              <title>{`${formatMonthFrench(point.month)} : ${point.size}`}</title>
            </circle>
            <circle cx={point.x} cy={point.y} r={isLast ? 3.5 : 2.5} fill="currentColor" />
          </g>
        );
      })}

      {/* Étiquettes sélectives : la valeur du dernier point, et les deux bornes de l'axe. */}
      <text
        x={coordinates.at(-1)!.x}
        y={coordinates.at(-1)!.y - 7}
        textAnchor="end"
        className="fill-foreground text-[11px] font-semibold"
      >
        {last.size}
      </text>
      <text x={PADDING.left} y={HEIGHT - 6} className="fill-foreground/60 text-[10px]">
        {formatMonthFrench(first.month)}
      </text>
      {points.length > 1 && (
        <text x={WIDTH - PADDING.right} y={HEIGHT - 6} textAnchor="end" className="fill-foreground/60 text-[10px]">
          {formatMonthFrench(last.month)}
        </text>
      )}
    </svg>
  );
}
