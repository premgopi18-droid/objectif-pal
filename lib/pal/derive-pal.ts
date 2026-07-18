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

    // On garde l'id à côté de la date : c'est l'achat d'ENTRÉE qu'annulera
    // « je ne l'ai pas acheté » depuis la vue PAL.
    const activePurchases = (book.purchases ?? [])
      .filter((purchase) => purchase.deleted_at === null)
      .map((purchase) => ({ id: purchase.id, purchasedAt: purchase.purchased_at as IsoDate }))
      .sort((left, right) => left.purchasedAt.localeCompare(right.purchasedAt));

    const finishedDates = (book.readings ?? [])
      .filter((reading) => reading.deleted_at === null && reading.status === "finished" && reading.finished_at !== null)
      .map((reading) => reading.finished_at as IsoDate);

    // La règle de pile vit dans le cœur partagé (derivePileStatus).
    const { entryDate, exitDate } = derivePileStatus(
      activePurchases.map((purchase) => purchase.purchasedAt),
      finishedDates,
    );
    if (entryDate === null) continue; // jamais entré : rachat d'un déjà-lu, rien à afficher
    // UNE entrée par livre : la pile compte des LIVRES à lire, pas des
    // exemplaires — deux achats du même livre ne la font grossir qu'une fois,
    // exactement comme une seule lecture annule leurs deux malus au bilan
    // (§3.3). Le solde du mois reste ainsi cohérent avec la pile affichée.
    purchaseDates.push(entryDate);

    if (exitDate !== null) {
      ownedFinishedDates.push(exitDate);
      continue; // sorti de la pile — l'achat, lui, reste dans l'historique
    }

    // L'achat qui a fait entrer le livre — le plus ancien à la date d'entrée.
    const entryPurchase = activePurchases.find((purchase) => purchase.purchasedAt === entryDate)!;
    entries.push({
      bookId: book.id,
      title: book.title,
      seriesName: book.series_name,
      issueNumber: book.issue_number,
      category: book.category,
      coverUrl: book.cover_url,
      // La plus ancienne entrée date l'arrivée dans la pile.
      purchasedAt: entryDate,
      purchaseId: entryPurchase.id,
      isInProgress: (book.readings ?? []).some(
        (reading) => reading.deleted_at === null && reading.status === "reading",
      ),
    });
  }

  entries.sort((left, right) => left.purchasedAt.localeCompare(right.purchasedAt));

  return { entries, purchaseDates, ownedFinishedDates };
}
