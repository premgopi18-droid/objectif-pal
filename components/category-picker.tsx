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
      {ALL_CATEGORIES.map((candidate) => (
        <button
          key={candidate}
          type="button"
          onClick={() => onChange(candidate)}
          aria-pressed={value === candidate}
          className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
            value === candidate ? "bg-amber-500 text-black" : "border border-foreground/20 opacity-70"
          }`}
        >
          {CATEGORY_LABELS[candidate]}
        </button>
      ))}
    </div>
  );
}
