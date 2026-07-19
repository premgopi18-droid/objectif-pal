import type { BookCategory } from "@/lib/scoring/types";
import type { Database } from "@/lib/supabase/database.types";

/**
 * La Bibliothèque — TOUS les livres, pas leurs projections (issue #49) : le
 * journal montre les livres à travers leurs lectures, la PAL à travers leurs
 * achats — ici, la table `books` elle-même, y compris les livres sans aucune
 * trace active (l'angle mort qui a motivé le ticket). Logique PURE, testée ;
 * la page ne fait que charger.
 */

type Tables = Database["public"]["Tables"];

/** Exactement la forme de la requête de la page — types dérivés de la base, comme derivePal. */
export type LibraryBookRow = Pick<
  Tables["books"]["Row"],
  "id" | "title" | "series_name" | "issue_number" | "category" | "cover_url" | "created_at"
> & {
  readings: Pick<Tables["readings"]["Row"], "status" | "deleted_at">[] | null;
  purchases: Pick<Tables["purchases"]["Row"], "deleted_at">[] | null;
};

/**
 * L'état d'un livre VU DE LA BIBLIOTHÈQUE — un résumé d'étagère, pas le
 * détail du journal. Priorité : une lecture en cours domine tout ; sinon un
 * livre déjà terminé ; sinon possédé non lu (la PAL, §4.6 — l'abandon n'en
 * sort pas) ; sinon abandonné sans possession ; sinon aucune trace active
 * (« sur l'étagère » — exactement les livres invisibles d'avant #49).
 */
export type LibraryStatus = "reading" | "finished" | "in-pile" | "abandoned" | "shelved";

export type LibraryEntry = {
  bookId: string;
  title: string;
  seriesName: string | null;
  issueNumber: string | null;
  category: BookCategory;
  coverUrl: string | null;
  createdAt: string;
  status: LibraryStatus;
  /** Les traces actives — le geste « retirer » les annonce avant de masquer. */
  activeReadingCount: number;
  activePurchaseCount: number;
};

export function deriveLibrary(rows: LibraryBookRow[]): LibraryEntry[] {
  return rows.map((row) => {
    // Défense en profondeur : la requête filtre déjà les embeds supprimés.
    const readings = (row.readings ?? []).filter((reading) => reading.deleted_at === null);
    const purchases = (row.purchases ?? []).filter((purchase) => purchase.deleted_at === null);

    const status: LibraryStatus = readings.some((reading) => reading.status === "reading")
      ? "reading"
      : readings.some((reading) => reading.status === "finished")
        ? "finished"
        : purchases.length > 0
          ? "in-pile"
          : readings.some((reading) => reading.status === "abandoned")
            ? "abandoned"
            : "shelved";

    return {
      bookId: row.id,
      title: row.title,
      seriesName: row.series_name,
      issueNumber: row.issue_number,
      category: row.category,
      coverUrl: row.cover_url,
      createdAt: row.created_at,
      status,
      activeReadingCount: readings.length,
      activePurchaseCount: purchases.length,
    };
  });
}

/** Minuscules + accents aplatis : « Astérix » se trouve en tapant « asterix ». */
const normalizeForSearch = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    // La plage des diacritiques combinants, en échappé : lisible, et insensible
    // à une normalisation d'encodage accidentelle du fichier (review #63).
    .replace(/[̀-ͯ]/g, "");

/** La recherche en mémoire (même réserve que les filtres du journal #34 : client tant que pas de pagination #32). */
export function filterLibraryEntries(entries: LibraryEntry[], searchText: string): LibraryEntry[] {
  const needle = normalizeForSearch(searchText.trim());
  if (!needle) return entries;
  return entries.filter(
    (entry) =>
      normalizeForSearch(entry.title).includes(needle) ||
      (entry.seriesName !== null && normalizeForSearch(entry.seriesName).includes(needle)),
  );
}

export type LibrarySortOrder = "recent" | "alphabetical";

export function sortLibraryEntries(entries: LibraryEntry[], order: LibrarySortOrder): LibraryEntry[] {
  const sorted = [...entries];
  if (order === "alphabetical") {
    sorted.sort((left, right) => left.title.localeCompare(right.title, "fr"));
  } else {
    sorted.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
  return sorted;
}
