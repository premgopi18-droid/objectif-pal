import { bookToMovement } from "@/lib/pal/derive-pal";
import { sortEntriesBy, type EntrySortOption } from "@/lib/sort/entry-sort";
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
  readings: Pick<Tables["readings"]["Row"], "status" | "started_at" | "finished_at" | "deleted_at">[] | null;
  purchases: Pick<Tables["purchases"]["Row"], "purchased_at" | "deleted_at">[] | null;
  ownerships?: Pick<Tables["ownerships"]["Row"], "owned_since" | "disposed_at" | "deleted_at">[] | null;
};

/**
 * L'état d'un livre VU DE L'INVENTAIRE (#152) : une lecture en cours domine ;
 * sinon déjà terminé ; sinon possédé non lu = « Dans la PAL » (§4.6 —
 * l'abandon n'en sort pas, une fiche sans lecture non plus). Trois états
 * seulement : dans un inventaire du possédé, « abandonné » et « sans
 * activité » sont des sous-cas de la pile — un possédé jamais fini est à
 * lire, point. Les cédés et les emprunts ne sont plus DANS la liste (#114,
 * #152) : leur histoire vit au Journal et au Bilan.
 */
export type LibraryStatus = "reading" | "finished" | "in-pile";

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
  /**
   * La DERNIÈRE activité du livre (#146) : max de la création de fiche, des
   * débuts/fins de lecture et des achats. C'est elle qui ordonne « Récents » —
   * la fiche créée avant-hier mais commencée hier remonte. Comparaison
   * lexicographique : dates ISO et timestamps se classent ensemble.
   */
  lastActivityAt: string;
};

/** Les faits minimaux de la règle d'inventaire — la forme des embeds PostgREST. */
export type InventoryFacts = {
  readings: Pick<Tables["readings"]["Row"], "status" | "finished_at" | "deleted_at">[] | null;
  purchases: Pick<Tables["purchases"]["Row"], "purchased_at" | "deleted_at">[] | null;
  ownerships?: Pick<Tables["ownerships"]["Row"], "owned_since" | "disposed_at" | "deleted_at">[] | null;
};

/**
 * LA règle d'appartenance à l'inventaire (#152, #160) — écrite UNE fois,
 * consommée par la Biblio ET le scan (« Déjà dans ta bibliothèque »). Un livre
 * appartient à l'inventaire s'il est possédé (possession active, ou achat
 * actif non cédé — la possession déclarée fait autorité), OU s'il est en pile
 * par le mouvement (le filet du rachat #117 : ligne close mais racheté).
 * Une fiche qui existe SANS ça (emprunt lu, cédé, historique) n'est PAS
 * « ta bibliothèque » — c'était le mensonge du scan (#160, vu en prod).
 */
export function isInInventory(facts: InventoryFacts): boolean {
  const readings = (facts.readings ?? []).filter((reading) => reading.deleted_at === null);
  const purchases = (facts.purchases ?? []).filter((purchase) => purchase.deleted_at === null);
  const ownerships = (facts.ownerships ?? []).filter((ownership) => ownership.deleted_at === null);
  const isDisposed = ownerships.some((ownership) => ownership.disposed_at !== null);
  const isOwned = ownerships.some((o) => o.disposed_at === null) || (purchases.length > 0 && !isDisposed);
  if (isOwned) return true;
  const movement = bookToMovement({
    purchases: purchases.map((purchase) => ({ purchasedAt: purchase.purchased_at, deletedAt: purchase.deleted_at })),
    readings: readings.map((reading) => ({ status: reading.status, finishedAt: reading.finished_at, deletedAt: reading.deleted_at })),
    ownerships: ownerships.map((ownership) => ({ ownedSince: ownership.owned_since, disposedAt: ownership.disposed_at, deletedAt: ownership.deleted_at })),
  });
  return movement !== null && !movement.exited;
}

export function deriveLibrary(rows: LibraryBookRow[]): LibraryEntry[] {
  const entries: LibraryEntry[] = [];
  for (const row of rows) {
    // Défense en profondeur : la requête filtre déjà les embeds supprimés.
    const readings = (row.readings ?? []).filter((reading) => reading.deleted_at === null);
    const purchases = (row.purchases ?? []).filter((purchase) => purchase.deleted_at === null);

    const ownerships = (row.ownerships ?? []).filter((ownership) => ownership.deleted_at === null);

    // LA règle d'inventaire partagée (#152/#160) — voir isInInventory : une
    // fiche hors inventaire vit au Journal et au Bilan, pas ici.
    if (!isInInventory(row)) continue;

    const status: LibraryStatus = readings.some((reading) => reading.status === "reading")
      ? "reading"
      : readings.some((reading) => reading.status === "finished")
        ? "finished"
        : "in-pile"; // possédé, jamais fini — à lire (l'abandon n'en sort pas, §4.6)

    // La dernière activité (#146) — created_at existe toujours : jamais vide.
    const lastActivityAt = [
      row.created_at,
      ...readings.flatMap((reading) => [reading.started_at, reading.finished_at]),
      ...purchases.map((purchase) => purchase.purchased_at),
    ]
      .filter((date): date is string => date !== null)
      .sort()
      .at(-1) as string;

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
      // Tout ce qui reste est possédé (le filtre #152 est passé) — sauf le
      // cas du filet du rachat, couvert par le mouvement.
      isOwned: true,
      authors: row.authors,
      publisher: row.publisher,
      pageCount: row.page_count,
      hasBarcode: row.barcode_raw !== null,
      lastActivityAt,
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

export type LibrarySortOrder = EntrySortOption;

/**
 * Le tri de l'inventaire — délégué au comparateur commun (#217). « activite »
 * garde la sémantique historique de la Biblio (#146) : dernière ACTIVITÉ, pas
 * seulement la création de fiche — la fiche d'avant-hier commencée hier
 * remonte, une rafale n'enterre plus le livre qu'on vient de finir.
 */
export function sortLibraryEntries(entries: LibraryEntry[], order: LibrarySortOrder): LibraryEntry[] {
  return sortEntriesBy(entries, order, {
    createdAt: (entry) => entry.createdAt,
    title: (entry) => entry.title,
    activityAt: (entry) => entry.lastActivityAt,
  });
}
