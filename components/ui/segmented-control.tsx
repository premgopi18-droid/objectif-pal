"use client";

/**
 * Le contrôle segmenté (design-specs §4) : une pill, le segment actif en dégradé.
 * Porte les vues Biblio (Pile/Tous) et Bilan (Bilan/Stats). Interactif → "use client".
 *
 * `aria-pressed` marque le segment actif ; le texte du segment actif est en `--bg0`
 * (encre sombre sur le dégradé — décision d'audit #66, cf. Button).
 */

type SegmentedOption<T extends string> = {
  value: T;
  label: string;
};

type SegmentedControlProps<T extends string> = {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Décrit le groupe pour les lecteurs d'écran (ex. « Vue de la bibliothèque »). */
  label: string;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={label} className="flex gap-1 rounded-full border border-line bg-card p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`flex-1 rounded-full py-2 text-sm font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan ${
              active ? "bg-grad text-bg0 shadow-grad" : "text-ink2"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
