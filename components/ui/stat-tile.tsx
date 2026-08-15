import type { ReactNode } from "react";

/**
 * La tuile de statistique (design-specs §4) : label majuscule + grande valeur
 * `tabular-nums` + hint optionnel. La valeur est colorable par sa sémantique
 * (positif/négatif/note) — jamais en déco. Purement présentatiel.
 */

type StatTileTone = "default" | "good" | "bad" | "amber";

const TONES: Record<StatTileTone, string> = {
  default: "text-ink",
  good: "text-green",
  bad: "text-red",
  amber: "text-amber",
};

type StatTileProps = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: StatTileTone;
  /** Complément de classes (état actif d'une tuile-filtre #241, etc.) — comme `Card`. */
  className?: string;
};

export function StatTile({ label, value, hint, tone = "default", className = "" }: StatTileProps) {
  return (
    <div className={`rounded-card border border-line bg-card px-4 py-3.5 ${className}`}>
      <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink3">{label}</div>
      <div className={`mt-0.5 text-3xl font-black tabular-nums ${TONES[tone]}`}>{value}</div>
      {hint != null && <div className="mt-0.5 text-xs text-ink2">{hint}</div>}
    </div>
  );
}
