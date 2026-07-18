import { derivePileStatus } from "@/lib/pal/derive-pal";
import { ALL_CATEGORIES } from "@/lib/scoring/types";
import type { BookCategory, IsoDate, Month } from "@/lib/scoring/types";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Le moteur des stats essentielles — specs §4.5, découpage P0 du 17/07/2026.
 * Troisième fonction pure de la famille (lib/scoring/monthly-report.ts,
 * lib/pal/derive-pal.ts) : des faits en entrée, un rapport en sortie. Zéro
 * requête, zéro horloge — le mois de référence arrive en ARGUMENT, fourni par
 * le client comme au bilan (le fuseau est une affaire d'UI, jamais de moteur).
 *
 * La règle de pile n'est PAS ré-implémentée : la santé PAL passe par
 * `derivePileStatus`, pour que la courbe raconte exactement la même histoire
 * que la vue PAL et le bilan (§4.5, les deux dénominateurs).
 */

type Tables = Database["public"]["Tables"];
type BookRow = Tables["books"]["Row"];
type PurchaseRow = Tables["purchases"]["Row"];
type ReadingRow = Tables["readings"]["Row"];

/**
 * Un livre tel que la page stats le charge — achats et lectures embarqués.
 * Champs en camelCase (la page mappe les Rows), mais chaque type est dérivé
 * des Rows générés : une colonne renommée casse le build, pas la prod.
 */
export type StatBookRecord = {
  id: BookRow["id"];
  category: BookRow["category"];
  publisher: BookRow["publisher"];
  seriesName: BookRow["series_name"];
  pageCount: BookRow["page_count"];
  deletedAt: BookRow["deleted_at"];
  purchases: { purchasedAt: PurchaseRow["purchased_at"]; deletedAt: PurchaseRow["deleted_at"] }[];
  readings: {
    status: ReadingRow["status"];
    startedAt: ReadingRow["started_at"];
    finishedAt: ReadingRow["finished_at"];
    rating: ReadingRow["rating"];
    deletedAt: ReadingRow["deleted_at"];
  }[];
};

export type StatsReport = {
  pal: {
    /** Possédés non lus à date — doit égaler `derivePal(...).entries.length`. */
    currentSize: number;
    /** Entrées de pile du mois de référence. */
    monthEntries: number;
    /** Sorties de pile du mois de référence. */
    monthExits: number;
    /** `monthEntries − monthExits`. */
    monthBalance: number;
    /** Taille cumulée de la pile, mois triés croissant — uniquement les mois avec un mouvement. */
    cumulativeByMonth: { month: Month; size: number }[];
    /** Lectures terminées de livres jamais possédés (emprunts) — une par lecture. */
    readOutsidePalCount: number;
  };
  volume: {
    finishedThisMonth: number;
    finishedThisYear: number;
    finishedTotal: number;
    /** Total par catégorie — les six clés toujours présentes, 0 compris. */
    finishedByCategory: Record<BookCategory, number>;
    /** Somme des `pageCount` connus sur les lectures terminées. */
    pagesRead: number;
    /** Lectures terminées sans `pageCount` — pour afficher « sur N connus ». */
    booksWithoutPageCount: number;
  };
  breakdown: {
    /** = `volume.finishedByCategory`, ré-exposé pour la clarté d'usage. */
    byCategory: Record<BookCategory, number>;
    /**
     * Trié count desc puis nom asc. Les éditeurs `null` sont exclus (0 % nul
     * mesuré sur les données réelles — pas de ligne « — » à inventer).
     */
    byPublisher: { publisher: string; count: number }[];
  };
  ratings: {
    /** Moyenne des lectures notées — `null` si aucune (jamais NaN, jamais 0). */
    averageOverall: number | null;
    averageThisMonth: number | null;
    averageThisYear: number | null;
    averageByCategory: Record<BookCategory, number | null>;
  };
};

/** `2026-07-13` → `2026-07`. */
const monthOf = (date: IsoDate): Month => date.slice(0, 7);
/** `2026-07-13` (ou `2026-07`) → `2026`. */
const yearOf = (value: string): string => value.slice(0, 4);

/** Accumulateur de moyenne : on somme, on divise à la fin — jamais par zéro. */
type RatingSum = { sum: number; count: number };
const emptyRatingSum = (): RatingSum => ({ sum: 0, count: 0 });
const averageOf = ({ sum, count }: RatingSum): number | null => (count === 0 ? null : sum / count);

const zeroByCategory = (): Record<BookCategory, number> =>
  Object.fromEntries(ALL_CATEGORIES.map((category) => [category, 0])) as Record<BookCategory, number>;

export function computeStats(books: StatBookRecord[], currentMonth: Month): StatsReport {
  const currentYear = yearOf(currentMonth);

  // Volume & répartitions.
  let finishedThisMonth = 0;
  let finishedThisYear = 0;
  let finishedTotal = 0;
  const finishedByCategory = zeroByCategory();
  let pagesRead = 0;
  let booksWithoutPageCount = 0;
  const countByPublisher = new Map<string, number>();

  // Notes.
  const overall = emptyRatingSum();
  const thisMonth = emptyRatingSum();
  const thisYear = emptyRatingSum();
  const byCategory = Object.fromEntries(ALL_CATEGORIES.map((category) => [category, emptyRatingSum()])) as Record<
    BookCategory,
    RatingSum
  >;

  // Santé PAL : +1 au mois d'entrée, −1 au mois de sortie, cumul à la fin.
  const pileDeltaByMonth = new Map<Month, number>();
  let monthEntries = 0;
  let monthExits = 0;
  let readOutsidePalCount = 0;

  // Une seule passe sur les livres — chaque lecture terminée n'est visitée
  // qu'une fois, tous les compteurs s'alimentent au passage.
  for (const book of books) {
    // Suppression douce : un livre retiré n'existe plus, achats et lectures compris.
    if (book.deletedAt !== null) continue;

    const activePurchaseDates = book.purchases
      .filter((purchase) => purchase.deletedAt === null)
      .map((purchase) => purchase.purchasedAt as IsoDate);
    const isOwned = activePurchaseDates.length > 0;

    const finishedDates: IsoDate[] = [];
    for (const reading of book.readings) {
      if (reading.deletedAt !== null) continue;
      if (reading.status !== "finished" || reading.finishedAt === null) continue;
      const finishedAt = reading.finishedAt as IsoDate;
      finishedDates.push(finishedAt);

      // Chaque lecture est un fait : une relecture compte deux fois ici
      // (volume, répartitions, notes) — mais une seule dans la pile, où la
      // règle « une sortie par livre » vit dans derivePileStatus.
      finishedTotal += 1;
      finishedByCategory[book.category] += 1;
      const inCurrentMonth = monthOf(finishedAt) === currentMonth;
      const inCurrentYear = yearOf(finishedAt) === currentYear;
      if (inCurrentMonth) finishedThisMonth += 1;
      if (inCurrentYear) finishedThisYear += 1;

      if (book.pageCount === null) {
        booksWithoutPageCount += 1;
      } else {
        pagesRead += book.pageCount;
      }

      if (book.publisher !== null) {
        countByPublisher.set(book.publisher, (countByPublisher.get(book.publisher) ?? 0) + 1);
      }

      if (reading.rating !== null) {
        overall.sum += reading.rating;
        overall.count += 1;
        byCategory[book.category].sum += reading.rating;
        byCategory[book.category].count += 1;
        if (inCurrentMonth) {
          thisMonth.sum += reading.rating;
          thisMonth.count += 1;
        }
        if (inCurrentYear) {
          thisYear.sum += reading.rating;
          thisYear.count += 1;
        }
      }

      // Jamais possédé = jamais dans la pile (§4.5) : cette lecture est un emprunt.
      if (!isOwned) readOutsidePalCount += 1;
    }

    // La règle de pile — importée, jamais ré-implémentée.
    const { entryDate, exitDate } = derivePileStatus(activePurchaseDates, finishedDates);
    if (entryDate === null) continue;
    const entryMonth = monthOf(entryDate);
    pileDeltaByMonth.set(entryMonth, (pileDeltaByMonth.get(entryMonth) ?? 0) + 1);
    if (entryMonth === currentMonth) monthEntries += 1;
    if (exitDate !== null) {
      const exitMonth = monthOf(exitDate);
      pileDeltaByMonth.set(exitMonth, (pileDeltaByMonth.get(exitMonth) ?? 0) - 1);
      if (exitMonth === currentMonth) monthExits += 1;
    }
  }

  // La courbe cumulée : mois à mouvement triés, cumul chronologique. La somme
  // finale EST la taille de pile à date (les livres entrés jamais sortis).
  let pileSize = 0;
  const cumulativeByMonth = [...pileDeltaByMonth.keys()].sort().map((month) => {
    pileSize += pileDeltaByMonth.get(month)!;
    return { month, size: pileSize };
  });

  const byPublisher = [...countByPublisher.entries()]
    .map(([publisher, count]) => ({ publisher, count }))
    .sort((left, right) => right.count - left.count || left.publisher.localeCompare(right.publisher));

  return {
    pal: {
      currentSize: pileSize,
      monthEntries,
      monthExits,
      monthBalance: monthEntries - monthExits,
      cumulativeByMonth,
      readOutsidePalCount,
    },
    volume: {
      finishedThisMonth,
      finishedThisYear,
      finishedTotal,
      finishedByCategory,
      pagesRead,
      booksWithoutPageCount,
    },
    breakdown: {
      byCategory: finishedByCategory,
      byPublisher,
    },
    ratings: {
      averageOverall: averageOf(overall),
      averageThisMonth: averageOf(thisMonth),
      averageThisYear: averageOf(thisYear),
      averageByCategory: Object.fromEntries(
        ALL_CATEGORIES.map((category) => [category, averageOf(byCategory[category])]),
      ) as Record<BookCategory, number | null>,
    },
  };
}
