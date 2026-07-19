"use client";

import { useId } from "react";
import { formatMonthFrench } from "@/lib/dates";
import type { Month } from "@/lib/scoring/types";

/**
 * La courbe cumulée de la pile — SVG inline, zéro dépendance de charting
 * (specs §10). Série unique (design-specs §5) : pas de légende, le titre et
 * l'`aria-label` la nomment. Trait en dégradé signature, aire violette
 * translucide, point terminal cyan, grille discrète, labels en `--ink3`.
 * Axe du temps honnête : l'appelant fournit des mois CONSÉCUTIFS
 * (fillMonthGaps), jamais compressés.
 */

const WIDTH = 320;
const HEIGHT = 120;
const PADDING = { top: 16, right: 12, bottom: 22, left: 12 };
/** Les lignes de grille horizontales — repères discrets, jamais du bruit. */
const GRID_FRACTIONS = [0.25, 0.5, 0.75] as const;
/** Au-delà, les points visibles deviennent du bruit — on ne garde que le dernier. */
const MAX_VISIBLE_DOTS = 18;

type PalCurveProps = {
  points: { month: Month; size: number }[];
};

export function PalCurve({ points }: PalCurveProps) {
  // Des ids uniques pour les dégradés : deux courbes sur la même page ne se
  // voleraient pas leurs `url(#…)` (rendu SSR/CSR stable via useId).
  const gradientId = useId();
  const lineGradient = `${gradientId}-line`;
  const fillGradient = `${gradientId}-fill`;

  if (points.length === 0) {
    return <p className="text-sm text-ink3">La pile n&apos;a pas encore d&apos;historique.</p>;
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
  const linePath = `M ${polyline.replaceAll(" ", " L ")}`;
  const area = `M ${coordinates[0].x},${baseline} L ${polyline.replaceAll(" ", " L ")} L ${coordinates.at(-1)!.x},${baseline} Z`;

  const first = points[0];
  const last = points.at(-1)!;
  const lastPoint = coordinates.at(-1)!;
  const showAllDots = points.length <= MAX_VISIBLE_DOTS;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`Courbe de la pile : ${first.size} en ${formatMonthFrench(first.month)}, ${last.size} en ${formatMonthFrench(last.month)}.`}
      className="block h-auto w-full"
    >
      <defs>
        {/* Le trait porte le dégradé signature (horizontal, magenta → cyan). */}
        <linearGradient id={lineGradient} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--magenta)" />
          <stop offset="0.5" stopColor="var(--violet)" />
          <stop offset="1" stopColor="var(--cyan)" />
        </linearGradient>
        {/* L'aire : voile violet qui s'évanouit vers la ligne de base. */}
        <linearGradient id={fillGradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--violet)" stopOpacity="0.35" />
          <stop offset="1" stopColor="var(--violet)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Grille discrète : des repères horizontaux, l'œil s'y raccroche sans bruit. */}
      {GRID_FRACTIONS.map((fraction) => {
        const gridY = PADDING.top + fraction * plotHeight;
        return (
          <line
            key={fraction}
            x1={PADDING.left}
            y1={gridY}
            x2={WIDTH - PADDING.right}
            y2={gridY}
            className="stroke-line"
          />
        );
      })}
      <line x1={PADDING.left} y1={baseline} x2={WIDTH - PADDING.right} y2={baseline} className="stroke-line" />

      {points.length > 1 && <path d={area} fill={`url(#${fillGradient})`} />}
      {points.length > 1 && (
        <path
          d={linePath}
          fill="none"
          stroke={`url(#${lineGradient})`}
          strokeWidth={3}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}

      {coordinates.map((point, index) => {
        const isLast = index === coordinates.length - 1;
        return (
          // Cible tactile plus large que la marque : le cercle transparent porte
          // l'infobulle native — pour TOUS les points, même quand les marques
          // visibles sont masquées (historique long, review #38).
          <g key={point.month}>
            <circle cx={point.x} cy={point.y} r={10} fill="transparent">
              <title>{`${formatMonthFrench(point.month)} : ${point.size}`}</title>
            </circle>
            {isLast ? (
              // Le point terminal — cyan, la valeur d'aujourd'hui.
              <circle cx={point.x} cy={point.y} r={4} fill="var(--cyan)" />
            ) : (
              showAllDots && <circle cx={point.x} cy={point.y} r={2.5} fill="var(--violet)" />
            )}
          </g>
        );
      })}

      {/* Étiquettes sélectives : la valeur du dernier point, et les deux bornes de l'axe. */}
      <text x={lastPoint.x} y={lastPoint.y - 8} textAnchor="end" className="fill-ink text-[11px] font-bold">
        {last.size}
      </text>
      <text x={PADDING.left} y={HEIGHT - 6} className="fill-ink3 text-[10px]">
        {formatMonthFrench(first.month)}
      </text>
      {points.length > 1 && (
        <text x={WIDTH - PADDING.right} y={HEIGHT - 6} textAnchor="end" className="fill-ink3 text-[10px]">
          {formatMonthFrench(last.month)}
        </text>
      )}
    </svg>
  );
}
