import { ALL_CATEGORIES, CATEGORY_LABELS } from "@/lib/books/categories";
import type { BookCategory } from "@/lib/scoring/types";
import { matchesSearch } from "@/lib/search/entry-search";
import type { SeriesProgress } from "@/lib/series/derive-series";
import { matchesSeriesFilter, type SeriesFilter } from "@/lib/series/copy";

/**
 * Les filtres du segment « Séries » (#319) — purs, testés : recherche par nom
 * (même normalisation que la Biblio, accents et casse ignorés), catégorie de
 * la série (la majorité de ses tomes), état. Les trois se cumulent.
 */

export type SeriesCategoryFilter = "all" | BookCategory;

export type SeriesListFilters = {
  query: string;
  category: SeriesCategoryFilter;
  status: SeriesFilter;
};

const matchesQuery = (progress: Pick<SeriesProgress, "name">, query: string): boolean =>
  matchesSearch(progress, query, { title: (entry) => entry.name, seriesName: () => null });

const matchesCategory = (progress: Pick<SeriesProgress, "category">, category: SeriesCategoryFilter): boolean =>
  category === "all" || progress.category === category;

/** Recherche + catégorie — ce que les chips d'état comptent ensuite. */
export function filterSeriesByQueryAndCategory<T extends Pick<SeriesProgress, "name" | "category">>(
  list: readonly T[],
  filters: Pick<SeriesListFilters, "query" | "category">,
): T[] {
  return list.filter((progress) => matchesQuery(progress, filters.query) && matchesCategory(progress, filters.category));
}

/** Les trois filtres cumulés. */
export function filterSeriesProgress<T extends Pick<SeriesProgress, "name" | "category" | "status" | "isNotStarted">>(list: readonly T[], filters: SeriesListFilters): T[] {
  return filterSeriesByQueryAndCategory(list, filters).filter((progress) => matchesSeriesFilter(progress, filters.status));
}

export type SeriesCategoryChip = { value: SeriesCategoryFilter; label: string };

/** « Tous les types », puis les catégories PRÉSENTES seulement, dans l'ordre du barème, avec leur compte — les options du sélecteur. */
export function categoryChips(list: readonly Pick<SeriesProgress, "category">[]): SeriesCategoryChip[] {
  const counts = new Map<BookCategory, number>();
  for (const progress of list) counts.set(progress.category, (counts.get(progress.category) ?? 0) + 1);
  return [
    { value: "all", label: "Tous les types" },
    ...ALL_CATEGORIES.filter((category) => counts.has(category)).map((category) => ({
      value: category,
      label: `${CATEGORY_LABELS[category]} (${counts.get(category) ?? 0})`,
    })),
  ];
}
