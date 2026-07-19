"use client";

import { ALL_CATEGORIES, CATEGORY_LABELS } from "@/lib/books/categories";
import type { BookCategory } from "@/lib/scoring/types";

/**
 * Le sélecteur de catégorie du barème — les six pastilles, corrigeables en un
 * tap (specs §4.1) : le même rendu dans la feuille de scan et la saisie manuelle.
 */

type CategoryPickerProps = {
  value: BookCategory;
  onChange: (category: BookCategory) => void;
};

export function CategoryPicker({ value, onChange }: CategoryPickerProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {ALL_CATEGORIES.map((candidate) => {
        const active = value === candidate;
        return (
          <button
            key={candidate}
            type="button"
            onClick={() => onChange(candidate)}
            aria-pressed={active}
            // Chip actif au dégradé signature (texte en --bg0, audit #66) ; inactif calme
            // sur surface --card. Corrigeable en un tap (specs §4.1).
            className={`rounded-full border px-4 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan ${
              active ? "bg-grad border-transparent text-bg0" : "border-line bg-card text-ink2"
            }`}
          >
            {CATEGORY_LABELS[candidate]}
          </button>
        );
      })}
    </div>
  );
}
