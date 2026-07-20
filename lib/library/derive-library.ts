import { bookToMovement } from "@/lib/pal/derive-pal";
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
  | "id"
  | "title"
  | "series_name"
  | "issue_number"
  | "category"
  | "cover_url"
  | "created_at"
  // Non affichés dans la liste — ils remplissent le formulaire d'édition (#100).
  | "authors"
  | "publisher"
  | "page_count"
  | "barcode_raw"
> & {
  // `finished_at` et `purchased_at` sont nécessaires au réducteur de pile
  // partagé (il raisonne sur des dates, pas sur des comptages).
  readings: Pick<Tables["readings"]["Row"], "status" | "finished_at" | "deleted_at">[] | null;
  purchases: Pick<Tables["purchases"]["Row"], "purchased_at" | "deleted_at">[] | null;
  ownerships?: Pick<Tables["ownerships"]["Row"], "owned_since" | "disposed_at" | "deleted_at">[] | null;
};

/**
 * L'état d'un livre VU DE LA BIBLIOTHÈQUE — un résumé d'étagère, pas le
 * détail du journal. Priorité : une lecture en cours domine tout ; sinon un
 * livre déjà terminé ; sinon possédé non lu (la PAL, §4.6 — l'abandon n'en
 * sort pas) ; sinon abandonné sans possession ; sinon aucune trace active
 * (« sur l'étagère » — exactement les livres invisibles d'avant #49).
 *
 * Les livres CÉDÉS (donné, revendu — #101) ne sont plus un statut : depuis
 * #114, « retirer de ma bibliothèque » retire vraiment — ils sortent de la
 * liste. Leurs lectures et points restent au journal, au bilan et aux stats.
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
  /** Le livre est-il possédé aujourd'hui ? Sinon c'est un emprunt, ou un livre parti (#101). */
  isOwned: boolean;
  /** Les champs éditables (#100) — portés jusqu'au formulaire, jamais affichés en liste. */
  authors: string | null;
  publisher: string | null;
  pageCount: number | null;
  /**
   * Un livre SANS code-barres ne peut pas être rescanné : l'édition est sa
   * seule voie de correction (#100). La vue s'en sert pour le dire.
   */
  hasBarcode: boolean;
};

export function deriveLibrary(rows: LibraryBookRow[]): LibraryEntry[] {
  const entries: LibraryEntry[] = [];
  for (const row of rows) {
    // Défense en profondeur : la requête filtre déjà les embeds supprimés.
    const readings = (row.readings ?? []).filter((reading) => reading.deleted_at === null);
    const purchases = (row.purchases ?? []).filter((purchase) => purchase.deleted_at === null);

    const ownerships = (row.ownerships ?? []).filter((ownership) => ownership.deleted_at === null);

    const isDisposed = ownerships.some((ownership) => ownership.disposed_at !== null);

    // La possession passe par le réducteur PARTAGÉ (#78/#101) : la règle « ce
    // livre est-il dans la pile ? » n'est écrite qu'une fois, dans
    // lib/pal/derive-pal — la Biblio, la Pile et les stats répondent donc
    // toujours la même chose (§4.5). `movement` est nul quand le livre n'est
    // jamais entré en pile (emprunt, ou acquisition d'un déjà-lu §3.3).
    const movement = bookToMovement({
      purchases: purchases.map((purchase) => ({
        purchasedAt: purchase.purchased_at,
        deletedAt: purchase.deleted_at,
      })),
      readings: readings.map((reading) => ({
        status: reading.status,
        finishedAt: reading.finished_at,
        deletedAt: reading.deleted_at,
      })),
      ownerships: ownerships.map((ownership) => ({
        ownedSince: ownership.owned_since,
        disposedAt: ownership.disposed_at,
        deletedAt: ownership.deleted_at,
      })),
    });
    const isInPile = movement !== null && !movement.exited;

    // « Retirer de ma bibliothèque » retire VRAIMENT (#114) : un livre cédé
    // (donné, revendu) sort de la liste — son histoire, elle, ne bouge pas
    // (lectures au journal, points au bilan, mouvements sur la courbe).
    // SAUF s'il est revenu en pile par le filet du rachat (#117, review #118) :
    // la ligne de possession peut être restée close alors que le mouvement dit
    // « racheté » — le masquer contredirait le volet Pile du même écran.
    if (isDisposed && !isInPile) continue;

    const status: LibraryStatus = readings.some((reading) => reading.status === "reading")
      ? "reading"
      : readings.some((reading) => reading.status === "finished")
        ? "finished"
        : isInPile
          ? "in-pile"
          : readings.some((reading) => reading.status === "abandoned")
            ? "abandoned"
            : "shelved";

    entries.push({
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
      // Possédé = une possession déclarée, ou un achat actif. Les cédés sont
      // déjà sortis de la liste (#114) — ce qui distingue ici un livre de
      // l'étagère d'un livre seulement LU (emprunt, médiathèque).
      isOwned: ownerships.length > 0 || purchases.length > 0,
      authors: row.authors,
      publisher: row.publisher,
      pageCount: row.page_count,
      hasBarcode: row.barcode_raw !== null,
    });
  }
  return entries;
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
