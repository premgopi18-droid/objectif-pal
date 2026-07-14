import type { BookCategory, IsoDate, ReadingStatus } from "@/lib/scoring/types";

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
  isInProgress: boolean;
};

/** Un livre tel que la page le charge — achats et lectures embarqués. */
export type PalBookRecord = {
  id: string;
  title: string;
  series_name: string | null;
  issue_number: string | null;
  category: BookCategory;
  cover_url: string | null;
  deleted_at: string | null;
  purchases: { purchased_at: IsoDate; deleted_at: string | null }[] | null;
  readings: { status: ReadingStatus; finished_at: IsoDate | null; deleted_at: string | null }[] | null;
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

    const activePurchaseDates = (book.purchases ?? [])
      .filter((purchase) => purchase.deleted_at === null)
      .map((purchase) => purchase.purchased_at)
      .sort();
    // Pas d'achat = pas possédé : jamais dans la pile, même lu (emprunt).
    if (activePurchaseDates.length === 0) continue;

    const finishedDates = (book.readings ?? [])
      .filter((reading) => reading.deleted_at === null && reading.status === "finished" && reading.finished_at !== null)
      .map((reading) => reading.finished_at as IsoDate)
      .sort();

    // ENTRÉES : un achat n'entre que si aucune lecture n'était terminée à une
    // date ≤ la date d'achat — sinon c'est le rachat d'un déjà-lu (§3.3).
    const entryDates = activePurchaseDates.filter(
      (purchasedAt) => !finishedDates.some((finishedAt) => finishedAt <= purchasedAt),
    );
    if (entryDates.length === 0) continue; // jamais entré : rien à sortir, rien à afficher
    // UNE entrée par livre : la pile compte des LIVRES à lire, pas des
    // exemplaires — deux achats du même livre ne la font grossir qu'une fois,
    // exactement comme une seule lecture annule leurs deux malus au bilan
    // (§3.3). Le solde du mois reste ainsi cohérent avec la pile affichée.
    purchaseDates.push(entryDates[0]);

    // SORTIE : la première fin survenue alors que le livre était en pile.
    // (Une fin ≤ la première entrée aurait empêché cette entrée d'exister.)
    const exitDate = finishedDates.find((finishedAt) => finishedAt >= entryDates[0]);
    if (exitDate) {
      ownedFinishedDates.push(exitDate);
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
      purchasedAt: entryDates[0],
      isInProgress: (book.readings ?? []).some(
        (reading) => reading.deleted_at === null && reading.status === "reading",
      ),
    });
  }

  entries.sort((left, right) => left.purchasedAt.localeCompare(right.purchasedAt));

  return { entries, purchaseDates, ownedFinishedDates };
}
