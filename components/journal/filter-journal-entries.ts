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
 * les points), sinon celui de son début (ticket #34). `null` quand la lecture
 * n'a aucune date connue (« déjà lu » de l'étagère d'avant, #101) : elle
 * n'appartient à aucun mois, et n'apparaît donc sous aucun filtre de mois.
 */
export const journalEntryMonth = (entry: JournalEntry): Month | null =>
  (entry.finishedAt ?? entry.startedAt)?.slice(0, 7) ?? null;

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
    const month = journalEntryMonth(entry);
    if (month !== null) months.add(month);
  }
  return [...months].sort().reverse();
}

/**
 * L'ordre du journal (#146) : l'activité d'abord, le temps ensuite, le
 * sans-date à la fin. Le tri SQL par `started_at desc` mettait les NULL en
 * PREMIER (comportement PostgreSQL en desc) : les « déjà lu » sans date de
 * rafale enterraient la lecture en cours — le bug qui a motivé le ticket.
 *
 *  1. EN COURS (début récent d'abord) — la vie active, 1-3 livres ;
 *  2. TERMINÉES datées, par FIN décroissante — « je viens de le lire » en haut ;
 *  3. ABANDONNÉES (début récent d'abord) ;
 *  4. SANS-DATE (ni début ni fin) tout en bas — elles n'appartiennent à aucun
 *     moment, elles ne doivent enterrer personne.
 */
const journalRankOf = (entry: JournalEntry): number => {
  if (entry.status === "reading") return 0;
  if (entry.status === "finished" && entry.finishedAt !== null) return 1;
  if (entry.status === "abandoned") return 2;
  return 3; // terminée sans aucune date
};

/** La date qui ordonne DANS un groupe — désc. : la plus récente d'abord. */
const journalSortDateOf = (entry: JournalEntry): string =>
  entry.status === "finished" ? (entry.finishedAt ?? "") : (entry.startedAt ?? "");

export function sortJournalEntries(entries: JournalEntry[]): JournalEntry[] {
  return [...entries].sort((left, right) => {
    const rank = journalRankOf(left) - journalRankOf(right);
    if (rank !== 0) return rank;
    return journalSortDateOf(right).localeCompare(journalSortDateOf(left));
  });
}

/**
 * Le séparateur de mois AU-DESSUS d'une entrée (#146) — uniquement dans la
 * section des terminées datées (le carnet de lecture, lisible à l'antenne) :
 * le mois de la fin, quand il change par rapport à l'entrée précédente.
 * `null` = pas de séparateur (autres sections, ou même mois).
 */
export function monthSeparatorBefore(previous: JournalEntry | null, entry: JournalEntry): Month | null {
  if (entry.status !== "finished" || entry.finishedAt === null) return null;
  const month = entry.finishedAt.slice(0, 7);
  const previousMonth =
    previous !== null && previous.status === "finished" && previous.finishedAt !== null
      ? previous.finishedAt.slice(0, 7)
      : null;
  return month === previousMonth ? null : month;
}
