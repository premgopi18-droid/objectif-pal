import type { BookCategory, Month, ReadingStatus } from "@/lib/scoring/types";
import type { JournalEntry } from "./journal-list";

/**
 * Le filtrage du journal — specs §4.2 : état, catégorie, série, mois,
 * combinables (ET logique). Fonctions pures sur la liste déjà chargée :
 * tant que le journal charge tout (cf. tech-debt #32 lot C), filtrer en
 * mémoire est un simple `Array.filter` — aucune requête ajoutée. Si la
 * pagination server-side arrive un jour, ces filtres migreront en params de
 * requête — ne PAS dupliquer la logique entre les deux.
 */

/** `"all"` = pas de filtre sur cette dimension. */
export type JournalFilters = {
  status: "all" | ReadingStatus;
  category: "all" | BookCategory;
  seriesName: "all" | string;
  month: "all" | Month;
};

export const NO_JOURNAL_FILTERS: JournalFilters = { status: "all", category: "all", seriesName: "all", month: "all" };

/**
 * Le mois d'une entrée : celui de sa FIN si elle existe (c'est elle qui date
 * les points), sinon celui de son début (ticket #34).
 */
export const journalEntryMonth = (entry: JournalEntry): Month => (entry.finishedAt ?? entry.startedAt).slice(0, 7);

export function filterJournalEntries(entries: JournalEntry[], filters: JournalFilters): JournalEntry[] {
  return entries.filter(
    (entry) =>
      (filters.status === "all" || entry.status === filters.status) &&
      (filters.category === "all" || entry.book.category === filters.category) &&
      (filters.seriesName === "all" || entry.book.seriesName === filters.seriesName) &&
      (filters.month === "all" || journalEntryMonth(entry) === filters.month),
  );
}

/** Les séries présentes dans le journal (sans les hors-série), triées A→Z. */
export function distinctSeriesNames(entries: JournalEntry[]): string[] {
  const names = new Set<string>();
  for (const entry of entries) {
    if (entry.book.seriesName !== null) names.add(entry.book.seriesName);
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

/** Les mois d'activité du journal, du plus récent au plus ancien. */
export function distinctMonths(entries: JournalEntry[]): Month[] {
  const months = new Set<Month>();
  for (const entry of entries) {
    months.add(journalEntryMonth(entry));
  }
  return [...months].sort().reverse();
}
