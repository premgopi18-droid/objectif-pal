import type { Database } from "@/lib/supabase/database.types";
import type { BookCategory, IsoDate } from "@/lib/scoring/types";

/**
 * La dérivation de la PAL — fonction PURE, sœur du moteur de score
 * (lib/scoring/monthly-report.ts) : des faits en entrée, la pile en sortie.
 * Le bilan et la PAL doivent raconter LA MÊME histoire (specs §4.5) — en cas
 * de doute, c'est la sémantique du moteur qui fait foi.
 *
 * Les règles de pile, alignées sur le moteur :
 *  - possédé = le livre a un achat ; une lecture sans achat (emprunt,
 *    médiathèque) n'est JAMAIS dans la pile (§4.5, les deux dénominateurs) ;
 *  - un achat n'est une ENTRÉE que si le livre n'avait AUCUNE lecture terminée
 *    à une date ≤ la date d'achat — racheter un livre déjà lu ne fait pas
 *    grossir la pile (§3.3, même règle que l'annulation du malus) ;
 *  - UNE sortie par livre : la PREMIÈRE fin de lecture d'un livre alors en
 *    pile. Une relecture re-rapporte ses points mais ne re-vide pas la pile,
 *    et une fin antérieure à toute entrée ne sort rien (décision du 14/07/2026).
 *
 * Comme partout : dates ISO `YYYY-MM-DD`, comparaison lexicographique =
 * comparaison chronologique, jamais de `Date`.
 */

/** Ce que la vue PAL affiche pour un livre encore dans la pile. */
export type PalEntry = {
  bookId: string;
  title: string;
  seriesName: string | null;
  issueNumber: string | null;
  category: BookCategory;
  coverUrl: string | null;
  purchasedAt: IsoDate;
  /** L'achat qui a fait entrer le livre en pile — celui qu'annule « je ne l'ai pas acheté ». */
  purchaseId: string;
  isInProgress: boolean;
};

/**
 * Le cœur de la règle de pile pour UN livre — partagé entre la vue PAL et le
 * garde du doublon d'achat (lib/books/pile-guard.ts), pour que les deux
 * racontent la MÊME histoire. Reçoit les dates d'achat ACTIVES et les dates de
 * fin de lecture du livre (dans n'importe quel ordre — la fonction les trie).
 */
export type PileStatus = {
  /**
   * La date d'ENTRÉE en pile : le premier achat qui n'était pas déjà lu.
   * `null` = jamais entré (aucun achat, ou rachat d'un déjà-lu §3.3).
   */
  entryDate: IsoDate | null;
  /** La première fin survenue alors que le livre était en pile — sa SORTIE —, ou `null` s'il y est encore. */
  exitDate: IsoDate | null;
};

export function derivePileStatus(activePurchaseDates: IsoDate[], finishedDates: IsoDate[]): PileStatus {
  // Pas d'achat = pas possédé : jamais dans la pile, même lu (emprunt) — §4.5.
  if (activePurchaseDates.length === 0) return { entryDate: null, exitDate: null };
  const purchases = [...activePurchaseDates].sort();
  const finished = [...finishedDates].sort();

  // ENTRÉES : un achat n'entre que si aucune lecture n'était terminée à une
  // date ≤ la date d'achat — sinon c'est le rachat d'un déjà-lu (§3.3).
  const entryDates = purchases.filter(
    (purchasedAt) => !finished.some((finishedAt) => finishedAt <= purchasedAt),
  );
  if (entryDates.length === 0) return { entryDate: null, exitDate: null };
  const entryDate = entryDates[0];

  // SORTIE : la première fin survenue alors que le livre était en pile.
  // (Une fin ≤ la première entrée aurait empêché cette entrée d'exister.)
  const exitDate = finished.find((finishedAt) => finishedAt >= entryDate) ?? null;
  return { entryDate, exitDate };
}

/**
 * Les faits MINIMAUX que le réducteur partagé consomme — en camelCase, la
 * forme des moteurs (lib/stats). Les Rows snake_case de la base passent par
 * un adaptateur fin (cf. derivePal ci-dessous). Génériques : chaque appelant
 * garde ses champs propres (id d'achat, note de lecture…) à travers le filtre.
 */
export type PurchaseFact = { purchasedAt: string; deletedAt: string | null };
export type ReadingFact = { status: string; finishedAt: string | null; deletedAt: string | null };

/**
 * Les achats ACTIFS (non annulés par « je ne l'ai pas acheté »), triés du plus
 * ancien au plus récent — LE filtre de possession, écrit une seule fois (#78).
 */
export function activePurchasesOf<P extends PurchaseFact>(purchases: P[]): P[] {
  return purchases
    .filter((purchase) => purchase.deletedAt === null)
    .sort((left, right) => left.purchasedAt.localeCompare(right.purchasedAt));
}

/**
 * Les lectures TERMINÉES actives — les seules qui comptent comme FINS pour la
 * pile (§4.5/§4.6 : l'abandon n'est pas une fin, une lecture supprimée non
 * plus). LE filtre de fin, écrit une seule fois (#78). Le type se resserre au
 * passage : une lecture terminée a toujours sa date.
 */
export function finishedReadingsOf<R extends ReadingFact>(readings: R[]): (R & { finishedAt: IsoDate })[] {
  return readings.filter(
    (reading): reading is R & { finishedAt: IsoDate } =>
      reading.deletedAt === null && reading.status === "finished" && reading.finishedAt !== null,
  );
}

/**
 * Les lectures EN COURS actives — celles qui font dire « je suis dedans » à la
 * vue PAL, et « ça traîne » aux stats (#30 lot A) quand elles durent. Même
 * esprit que les deux filtres ci-dessus : écrit une seule fois, jamais recopié.
 */
export function inProgressReadingsOf<R extends ReadingFact>(readings: R[]): R[] {
  return readings.filter((reading) => reading.deletedAt === null && reading.status === "reading");
}

/** Le mouvement de pile d'UN livre entré : son entrée, sa sortie éventuelle, l'achat d'entrée. */
export type BookMovement<P extends PurchaseFact> = {
  /** La date d'ENTRÉE en pile (le premier achat pas-déjà-lu). */
  entryDate: IsoDate;
  /** La première fin survenue en pile — sa SORTIE —, ou `null` s'il y est encore. */
  exitDate: IsoDate | null;
  /** L'achat qui a fait entrer le livre — celui qu'annule « je ne l'ai pas acheté ». */
  entryPurchase: P;
};

/**
 * Le réducteur PARTAGÉ faits → mouvement (issue #78) : filtrer les achats
 * actifs et les fins de lecture terminées, puis dériver le statut de pile.
 * `derivePal` (vue PAL), `computeStats` (stats) et les tests de santé passent
 * TOUS par ici — un futur critère de filtrage ne s'ajoute qu'à un endroit.
 * Rend `null` si le livre n'est jamais entré en pile (aucun achat actif, ou
 * rachat d'un déjà-lu §3.3).
 */
export function bookToMovement<P extends PurchaseFact, R extends ReadingFact>(book: {
  purchases: P[];
  readings: R[];
}): BookMovement<P> | null {
  const activePurchases = activePurchasesOf(book.purchases);
  const finishedDates = finishedReadingsOf(book.readings).map((reading) => reading.finishedAt);

  // La règle de pile vit dans le cœur partagé (derivePileStatus).
  const { entryDate, exitDate } = derivePileStatus(
    activePurchases.map((purchase) => purchase.purchasedAt as IsoDate),
    finishedDates,
  );
  if (entryDate === null) return null;

  // L'achat d'entrée : le plus ancien achat actif à la date d'entrée (liste triée).
  const entryPurchase = activePurchases.find((purchase) => purchase.purchasedAt === entryDate)!;
  return { entryDate, exitDate, entryPurchase };
}

type Tables = Database["public"]["Tables"];

/**
 * Un livre tel que la page le charge — achats et lectures embarqués.
 * Dérivé des Rows générés : la forme reste explicite (fonction pure, entrée
 * assumée), mais chaque champ est garanti aligné sur le schéma.
 */
export type PalBookRecord = Pick<
  Tables["books"]["Row"],
  "id" | "title" | "series_name" | "issue_number" | "category" | "cover_url" | "deleted_at"
> & {
  purchases: Pick<Tables["purchases"]["Row"], "id" | "purchased_at" | "deleted_at">[] | null;
  readings: Pick<Tables["readings"]["Row"], "status" | "finished_at" | "deleted_at">[] | null;
};

/** Exactement ce que `PalView` consomme. */
export type PalDerivation = {
  /** Les livres encore dans la pile, du plus ancien achat au plus récent. */
  entries: PalEntry[];
  /** Les dates d'ENTRÉE de pile (une par livre : son premier achat pas-encore-lu). */
  purchaseDates: IsoDate[];
  /** Les dates de SORTIE de pile (une par livre : sa première fin). */
  ownedFinishedDates: IsoDate[];
};

export function derivePal(books: PalBookRecord[]): PalDerivation {
  const entries: PalEntry[] = [];
  const purchaseDates: IsoDate[] = [];
  const ownedFinishedDates: IsoDate[] = [];

  for (const book of books) {
    // Suppression douce : un livre retiré n'existe plus pour la pile.
    if (book.deleted_at !== null) continue;

    // Le réducteur partagé (#78), via un adaptateur fin snake_case → camelCase :
    // les Rows de la base parlent snake_case, le réducteur parle la langue des
    // moteurs. L'id d'achat traverse le filtre (générique) : c'est l'achat
    // d'ENTRÉE qu'annulera « je ne l'ai pas acheté » depuis la vue PAL.
    const movement = bookToMovement({
      purchases: (book.purchases ?? []).map((purchase) => ({
        id: purchase.id,
        purchasedAt: purchase.purchased_at,
        deletedAt: purchase.deleted_at,
      })),
      readings: (book.readings ?? []).map((reading) => ({
        status: reading.status,
        finishedAt: reading.finished_at,
        deletedAt: reading.deleted_at,
      })),
    });
    if (movement === null) continue; // jamais entré : rachat d'un déjà-lu, rien à afficher
    // UNE entrée par livre : la pile compte des LIVRES à lire, pas des
    // exemplaires — deux achats du même livre ne la font grossir qu'une fois,
    // exactement comme une seule lecture annule leurs deux malus au bilan
    // (§3.3). Le solde du mois reste ainsi cohérent avec la pile affichée.
    purchaseDates.push(movement.entryDate);

    if (movement.exitDate !== null) {
      ownedFinishedDates.push(movement.exitDate);
      continue; // sorti de la pile — l'achat, lui, reste dans l'historique
    }

    entries.push({
      bookId: book.id,
      title: book.title,
      seriesName: book.series_name,
      issueNumber: book.issue_number,
      category: book.category,
      coverUrl: book.cover_url,
      // La plus ancienne entrée date l'arrivée dans la pile.
      purchasedAt: movement.entryDate,
      purchaseId: movement.entryPurchase.id,
      isInProgress:
        inProgressReadingsOf(
          (book.readings ?? []).map((reading) => ({
            status: reading.status,
            finishedAt: reading.finished_at,
            deletedAt: reading.deleted_at,
          })),
        ).length > 0,
    });
  }

  entries.sort((left, right) => left.purchasedAt.localeCompare(right.purchasedAt));

  return { entries, purchaseDates, ownedFinishedDates };
}
