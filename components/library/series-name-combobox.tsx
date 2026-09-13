"use client";

import { useEffect, useId, useRef, useState } from "react";
import { searchSeries, type SeriesSuggestion } from "@/lib/series/actions";

/**
 * Le champ Série de l'édition de fiche en combobox (lot B, §4.17 « relier à la
 * même série ») : la saisie propose les séries du référentiel commun (préfixe
 * normalisé, 8 au plus). Choisir une suggestion pose son nom EXACT — le
 * rattachement par nom normalisé retombe alors sur la même ligne, sans passer
 * d'id. Taper un nouveau nom crée la série à l'enregistrement.
 *
 * a11y : `role="combobox"` + listbox, flèches, Entrée, Échap ; la liste est
 * annoncée, l'option active suivie par `aria-activedescendant`.
 */
const SEARCH_DEBOUNCE_MS = 250;
const MIN_PREFIX_LENGTH = 2;

export function SeriesNameCombobox({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className: string;
}) {
  const listId = useId();
  const [suggestions, setSuggestions] = useState<SeriesSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const lastQuery = useRef("");

  const needle = value.trim();
  const isSearchable = needle.length >= MIN_PREFIX_LENGTH;

  useEffect(() => {
    if (!isSearchable) return;
    lastQuery.current = needle;
    const timer = setTimeout(async () => {
      try {
        const found = await searchSeries(needle);
        // Une réponse en retard sur une frappe plus récente est jetée.
        if (lastQuery.current !== needle) return;
        // La suggestion identique au texte saisi n'apporte rien.
        setSuggestions(found.filter((suggestion) => suggestion.name !== needle));
        setActiveIndex(-1);
      } catch {
        setSuggestions([]);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [needle, isSearchable]);

  const pick = (suggestion: SeriesSuggestion) => {
    onChange(suggestion.name);
    setSuggestions([]);
    setIsOpen(false);
  };

  // Sous le préfixe minimal, la liste (peut-être d'une frappe plus longue) ne se montre pas.
  const expanded = isOpen && isSearchable && suggestions.length > 0;

  return (
    <div className="relative">
      <input
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setTimeout(() => setIsOpen(false), 120)}
        onKeyDown={(event) => {
          if (!expanded) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((index) => Math.min(suggestions.length - 1, index + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((index) => Math.max(-1, index - 1));
          } else if (event.key === "Enter" && activeIndex >= 0) {
            event.preventDefault();
            pick(suggestions[activeIndex]);
          } else if (event.key === "Escape") {
            setIsOpen(false);
          }
        }}
        className={className}
      />
      {expanded && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Séries existantes"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-xl border border-line bg-card2 py-1 shadow-float"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(suggestion)}
              className={`cursor-pointer px-3 py-2 text-sm text-ink ${index === activeIndex ? "bg-card" : ""}`}
            >
              {suggestion.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
