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

    // LA BIBLIO EST L'INVENTAIRE DU POSSÉDÉ (#152) : un emprunt lu, un livre
    // cédé (#114) ou une fiche sans rien n'y figurent pas — leur histoire vit
    // au Journal, leurs points au Bilan. SAUF le retour en pile par le filet
    // du rachat (#117, review #118) : le mouvement fait foi sur la ligne close.
    const isOwned = ownerships.some((o) => o.disposed_at === null) || (purchases.length > 0 && !isDisposed);
    if (!isOwned && !isInPile) continue;

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

export type LibrarySortOrder = "recent" | "alphabetical";

export function sortLibraryEntries(entries: LibraryEntry[], order: LibrarySortOrder): LibraryEntry[] {
  const sorted = [...entries];
  if (order === "alphabetical") {
    sorted.sort((left, right) => left.title.localeCompare(right.title, "fr"));
  } else {
    // « Récents » = dernière ACTIVITÉ (#146), plus la création de fiche : la
    // fiche d'avant-hier commencée hier remonte, une rafale n'enterre plus
    // le livre qu'on vient de finir.
    sorted.sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt));
  }
  return sorted;
}
