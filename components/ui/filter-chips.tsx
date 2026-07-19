"use client";

/**
 * Les chips de filtre (design-specs §4) : rangée pill défilable, chip actif en
 * dégradé. Restyle les filtres du journal. Interactif → "use client".
 *
 * `aria-pressed` marque le chip actif ; texte du chip actif en `--bg0` (audit #66).
 */

type FilterChip<T extends string> = {
  value: T;
  label: string;
};

type FilterChipsProps<T extends string> = {
  chips: readonly FilterChip<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Décrit le groupe pour les lecteurs d'écran (ex. « Filtres »). */
  label: string;
};

export function FilterChips<T extends string>({ chips, value, onChange, label }: FilterChipsProps<T>) {
  return (
    <div role="group" aria-label={label} className="flex gap-2 overflow-x-auto pb-1">
      {chips.map((chip) => {
        const active = chip.value === value;
        return (
          <button
            key={chip.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(chip.value)}
            className={`flex-none rounded-full border px-3 py-1.5 text-[13px] font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan ${
              active ? "bg-grad border-transparent text-bg0" : "border-line bg-card text-ink2"
            }`}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
