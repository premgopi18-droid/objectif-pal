import type { BookCategory, ReadingStatus } from "@/lib/scoring/types";
import { ALL_CATEGORIES } from "@/lib/books/categories";

/**
 * L'URL du journal paginé (#32 lot C) — filtres et profondeur vivent dans les
 * searchParams : la liste reste une PROP du serveur (les gestes rafraîchissent
 * par revalidation, comme avant), l'état est partageable, et le bouton retour
 * retombe sur la vue exacte. Codec PUR et testé : une URL forgée ne produit
 * jamais un filtre invalide — elle retombe sur le défaut.
 */

/** `"all"` = pas de filtre sur cette dimension. */
export type JournalFilters = {
  status: "all" | ReadingStatus;
  category: "all" | BookCategory;
  seriesName: "all" | string;
  month: "all" | string;
};

export const NO_JOURNAL_FILTERS: JournalFilters = { status: "all", category: "all", seriesName: "all", month: "all" };

/**
 * Les tris du journal (#217) — « activite » est LE défaut (#146 : l'en-cours
 * en tête, les sans-date relégués — c'est déjà « date de lecture », en mieux
 * rangé) ; les autres sont des vues alternatives, sans séparateurs de mois
 * (ils n'ont de sens que dans l'ordre activité).
 */
export type JournalSort = "activite" | "lecture" | "note" | "ajout" | "ajout-ancien" | "titre" | "titre-inverse";

export const DEFAULT_JOURNAL_SORT: JournalSort = "activite";

const JOURNAL_SORTS: JournalSort[] = ["activite", "lecture", "note", "ajout", "ajout-ancien", "titre", "titre-inverse"];

/** searchParams → tri sûr (valeur inconnue = défaut). */
export function parseJournalSort(searchParams: RawSearchParams): JournalSort {
  const raw = first(searchParams.tri);
  return JOURNAL_SORTS.includes(raw as JournalSort) ? (raw as JournalSort) : DEFAULT_JOURNAL_SORT;
}

/** La page du journal : ce qu'un écran de téléphone absorbe sans peine. */
export const JOURNAL_PAGE_SIZE = 50;
/** Le plafond de profondeur — au-delà, une URL forgée ne charge pas plus. */
const MAX_DEPTH = 1000;

const READING_STATUSES: ReadingStatus[] = ["reading", "finished", "abandoned"];
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

type RawSearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/** searchParams → filtres sûrs (une valeur inconnue retombe sur "all"). */
export function parseJournalFilters(searchParams: RawSearchParams): JournalFilters {
  const status = first(searchParams.etat);
  const category = first(searchParams.categorie);
  const seriesName = first(searchParams.serie);
  const month = first(searchParams.mois);
  return {
    status: READING_STATUSES.includes(status as ReadingStatus) ? (status as ReadingStatus) : "all",
    category: ALL_CATEGORIES.includes(category as BookCategory) ? (category as BookCategory) : "all",
    seriesName: seriesName ? seriesName : "all",
    month: month !== undefined && MONTH_PATTERN.test(month) ? month : "all",
  };
}

/** searchParams → profondeur de liste (multiple de la page, bornée). */
export function parseJournalDepth(searchParams: RawSearchParams): number {
  const raw = Number(first(searchParams.n));
  if (!Number.isInteger(raw) || raw <= JOURNAL_PAGE_SIZE) return JOURNAL_PAGE_SIZE;
  return Math.min(raw, MAX_DEPTH);
}

/**
 * Filtres + tri + profondeur → query string (sans « ? »). Les valeurs par
 * défaut n'apparaissent pas : l'URL nue reste `/journal`.
 */
export function journalSearchString(
  filters: JournalFilters,
  depth: number = JOURNAL_PAGE_SIZE,
  sort: JournalSort = DEFAULT_JOURNAL_SORT,
): string {
  const params = new URLSearchParams();
  if (filters.status !== "all") params.set("etat", filters.status);
  if (filters.category !== "all") params.set("categorie", filters.category);
  if (filters.seriesName !== "all") params.set("serie", filters.seriesName);
  if (filters.month !== "all") params.set("mois", filters.month);
  if (sort !== DEFAULT_JOURNAL_SORT) params.set("tri", sort);
  if (depth > JOURNAL_PAGE_SIZE) params.set("n", String(depth));
  return params.toString();
}

export const hasActiveJournalFilters = (filters: JournalFilters): boolean =>
  filters.status !== "all" || filters.category !== "all" || filters.seriesName !== "all" || filters.month !== "all";
