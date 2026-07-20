import { daysBetween, monthsBetween } from "@/lib/dates";
import {
  activeOwnershipOf,
  activePurchasesOf,
  bookToMovement,
  finishedReadingsOf,
  inProgressReadingsOf,
} from "@/lib/pal/derive-pal";
import { computePalHealth } from "@/lib/pal/health";
import { ALL_CATEGORIES } from "@/lib/scoring/types";
import type { BookCategory, IsoDate, Month } from "@/lib/scoring/types";
import type { Database } from "@/lib/supabase/database.types";
import { summarizeReadingEvents, type ReadingEventFact } from "@/lib/stats/reading-events";
import {
  deriveSeriesProgress,
  EMPTY_SERIES_CATALOG,
  type ReadVolumeFact,
  type SeriesCatalog,
  type SeriesProgress,
} from "@/lib/stats/series-catalog";

/**
 * Le moteur des stats essentielles — specs §4.5, découpage P0 du 17/07/2026.
 * Troisième fonction pure de la famille (lib/scoring/monthly-report.ts,
 * lib/pal/derive-pal.ts) : des faits en entrée, un rapport en sortie. Zéro
 * requête, zéro horloge — le mois de référence arrive en ARGUMENT, fourni par
 * le client comme au bilan (le fuseau est une affaire d'UI, jamais de moteur).
 *
 * La règle de pile n'est PAS ré-implémentée : la santé PAL passe par le
 * réducteur partagé `bookToMovement` (lib/pal/derive-pal, #78), pour que la
 * courbe raconte exactement la même histoire que la vue PAL et le bilan
 * (§4.5, les deux dénominateurs).
 */

type Tables = Database["public"]["Tables"];
type BookRow = Tables["books"]["Row"];
type PurchaseRow = Tables["purchases"]["Row"];
type ReadingRow = Tables["readings"]["Row"];
type OwnershipRow = Tables["ownerships"]["Row"];

/**
 * Un livre tel que la page stats le charge — achats et lectures embarqués.
 * Champs en camelCase (la page mappe les Rows), mais chaque type est dérivé
 * des Rows générés : une colonne renommée casse le build, pas la prod.
 */
export type StatBookRecord = {
  id: BookRow["id"];
  /** Le titre — affiché par les analyses avancées (lectures qui traînent, classement). */
  title: BookRow["title"];
  category: BookRow["category"];
  publisher: BookRow["publisher"];
  seriesName: BookRow["series_name"];
  /**
   * Le `gcd_id` du tome quand le livre a été résolu par GCD — le SEUL lien
   * fiable vers une série numérotée (#30, lot B). `null` ou absent pour les
   * livres BnF, Google Books, Metron ou saisis à la main : ils ne portent
   * qu'un nom de série en texte, et on n'invente pas de rattachement.
   */
  gcdIssueId?: number | null;
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
  /**
   * La possession déclarée (« je possède », #101) — OPTIONNELLE : les requêtes
   * qui ne l'embarquent pas encore dérivent la pile depuis les seuls achats,
   * exactement comme avant.
   */
  ownerships?: {
    ownedSince: OwnershipRow["owned_since"];
    disposedAt: OwnershipRow["disposed_at"];
    deletedAt: OwnershipRow["deleted_at"];
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
  /** Lot A du #30 — rythme : durées, lectures qui traînent, abandons & reprises. */
  rythme: RythmeReport;
  /** Lot B du #30 — répartition par série. */
  series: SeriesReport;
  /** Lot C du #30 — goûts avancés : séries et éditeurs classés, classement des lectures. */
  tastes: TastesReport;
  /** Lot D du #30 — volume temporel : moyenne par mois, meilleur mois. */
  monthly: MonthlyReport;
};

/**
 * Le SEUIL des « lectures qui traînent » : une lecture encore `reading` dont le
 * début remonte à plus de 60 jours (décision produit de Prem, 19/07/2026,
 * reportée dans les specs §4.5). Affichée en LISTE CALME, jamais en alerte :
 * l'app raconte une pile, elle ne fait pas la morale.
 */
export const STALLED_READING_DAYS = 60;

/**
 * Le volume MINIMAL pour qu'une série ou un éditeur entre au classement des
 * goûts : 3 lectures NOTÉES (décision produit de Prem, 19/07/2026, specs §4.5).
 * En dessous, une seule note 5 ferait une « meilleure série » mensongère.
 */
export const MIN_RATED_READINGS_TO_RANK = 3;

/** Une lecture en cours depuis trop longtemps — le lot A, en liste calme. */
export type StalledReading = {
  bookId: string;
  title: string;
  category: BookCategory;
  startedAt: IsoDate;
  /** Jours écoulés depuis le début, à la date `today` fournie en argument. */
  daysSinceStart: number;
};

/** Abandons et reprises d'un mois — issus du journal `reading_events`. */
export type MonthlyEventCounts = { month: Month; abandons: number; resumptions: number };

export type RythmeReport = {
  /**
   * Durée moyenne d'une lecture terminée, en jours (`finished_at − started_at`).
   * `null` si aucune lecture n'a de durée mesurable — jamais NaN, jamais 0.
   */
  averageDurationDays: number | null;
  averageDurationByCategory: Record<BookCategory, number | null>;
  /**
   * Lectures terminées dont la durée n'est pas mesurable (pas de `started_at`,
   * ou une fin antérieure au début) — pour afficher « sur N lectures datées ».
   */
  readingsWithoutDuration: number;
  /** Lectures encore en cours depuis plus de `STALLED_READING_DAYS` jours, la plus ancienne d'abord. */
  stalledReadings: StalledReading[];
  /** Abandons & reprises par mois, mois triés croissant — seuls les mois avec un événement. */
  eventsByMonth: MonthlyEventCounts[];
};

export type SeriesReport = {
  /**
   * Tomes lus par série : on compte les LIVRES distincts ayant au moins une
   * lecture terminée (une relecture ne fait pas un tome de plus). Trié count
   * desc puis nom asc. Les livres hors série (`series_name` nul) sont exclus.
   */
  volumesRead: { seriesName: string; count: number }[];
  /**
   * Les séries commencées reliées à GCD : tomes lus et tome suivant quand la
   * numérotation est exploitable (`lib/stats/series-catalog`). Vide sans
   * catalogue — on ne devine jamais un tome suivant.
   */
  inProgress: SeriesProgress[];
};

/** Une série ou un éditeur classé par la moyenne de ses lectures notées. */
export type RatedGroup = { name: string; average: number; ratedCount: number };

/** Une lecture notée, pour le classement. */
export type RankedReading = {
  bookId: string;
  title: string;
  category: BookCategory;
  rating: number;
  finishedAt: IsoDate;
};

export type TastesReport = {
  /**
   * Séries classées par moyenne DESC (puis nom asc) — seules celles qui
   * atteignent `MIN_RATED_READINGS_TO_RANK` lectures notées. La vue lit les
   * meilleures en tête et les décevantes en queue : une seule liste, deux bouts.
   */
  series: RatedGroup[];
  /** Idem pour les éditeurs — même seuil, même tri. */
  publishers: RatedGroup[];
  /** Toutes les lectures notées, note DESC puis fin la plus récente. */
  ranking: RankedReading[];
};

export type MonthlyReport = {
  /** Lectures terminées par mois, mois triés croissant — seuls les mois avec une fin. */
  finishedByMonth: { month: Month; count: number }[];
  /**
   * Moyenne de lectures par mois, sur TOUS les mois écoulés depuis la première
   * fin jusqu'au mois de référence — mois vides compris (les ignorer gonflerait
   * la moyenne). `null` si aucune lecture terminée.
   */
  averagePerMonth: number | null;
  /** Le mois le plus prolifique — en cas d'égalité, le plus ANCIEN. `null` si aucune fin. */
  bestMonth: { month: Month; count: number } | null;
};

/**
 * Le contexte des analyses avancées — tout ce que le moteur ne peut pas dériver
 * des livres seuls, fourni par l'appelant (jamais lu d'une horloge ici) :
 *  - `today` : la date locale de l'APPAREIL, qui date les lectures qui traînent.
 *    Absente, `rythme.stalledReadings` reste vide (rien à mesurer contre) ;
 *  - `readingEvents` : le journal d'états (`lib/stats/reading-events`), qui
 *    porte abandons et reprises. Absent, `rythme.eventsByMonth` reste vide.
 */
export type StatsContext = {
  today?: IsoDate;
  readingEvents?: ReadingEventFact[];
  /**
   * `seriesCatalog` : ce que GCD sait des séries commencées (numérotation),
   * chargé par la page. Absent, `series.inProgress` reste vide — la
   * répartition par série, elle, ne dépend de rien d'externe.
   */
  seriesCatalog?: SeriesCatalog;
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

/** Accumulateur de moyenne nommé — séries et éditeurs des goûts (lot C). */
type NamedRatingSums = Map<string, RatingSum>;

const addRating = (sums: NamedRatingSums, name: string, rating: number): void => {
  const current = sums.get(name) ?? emptyRatingSum();
  current.sum += rating;
  current.count += 1;
  sums.set(name, current);
};

/**
 * Les groupes qui atteignent le seuil de volume, moyenne DESC puis nom ASC —
 * la liste dont la vue lit les deux bouts (meilleurs / décevants).
 */
const rankGroups = (sums: NamedRatingSums): RatedGroup[] =>
  [...sums.entries()]
    .filter(([, sum]) => sum.count >= MIN_RATED_READINGS_TO_RANK)
    .map(([name, sum]) => ({ name, average: sum.sum / sum.count, ratedCount: sum.count }))
    .sort((left, right) => right.average - left.average || left.name.localeCompare(right.name));

export function computeStats(
  books: StatBookRecord[],
  currentMonth: Month,
  context: StatsContext = {},
): StatsReport {
  const currentYear = yearOf(currentMonth);
  const { today, readingEvents, seriesCatalog } = context;

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

  // Santé PAL : on collecte les MOUVEMENTS (une entrée / une sortie par livre),
  // qui alimentent ensuite la dérivation partagée (taille + solde) ET la courbe.
  const palEntryDates: IsoDate[] = [];
  const palExitDates: IsoDate[] = [];
  // Les mouvements dont la date est inconnue (#101) : du stock, jamais du flux.
  let palUndatedEntryCount = 0;
  let palUndatedExitCount = 0;
  let readOutsidePalCount = 0;

  // Analyses avancées (#30) — mêmes accumulateurs, MÊME passe : rien ne se
  // re-boucle sur les livres, chaque lecture n'est visitée qu'une fois.
  const durationOverall = emptyRatingSum(); // « sum » = jours cumulés, « count » = lectures datées
  const durationByCategory = Object.fromEntries(
    ALL_CATEGORIES.map((category) => [category, emptyRatingSum()]),
  ) as Record<BookCategory, RatingSum>;
  let readingsWithoutDuration = 0;
  const stalledReadings: StalledReading[] = [];
  const volumesReadBySeries = new Map<string, number>();
  const readVolumes: ReadVolumeFact[] = [];
  const ratingsBySeries: NamedRatingSums = new Map();
  const ratingsByPublisher: NamedRatingSums = new Map();
  const ranking: RankedReading[] = [];
  const finishedCountByMonth = new Map<Month, number>();

  // Une seule passe sur les livres — chaque lecture terminée n'est visitée
  // qu'une fois, tous les compteurs s'alimentent au passage.
  for (const book of books) {
    // Suppression douce : un livre retiré n'existe plus, achats et lectures compris.
    if (book.deletedAt !== null) continue;

    // Possédé = au moins un achat actif, OU une possession déclarée (#101) —
    // même une possession terminée (don, revente) prouve qu'on l'a eu, donc
    // que la lecture n'était pas un emprunt. Filtres partagés (lib/pal, #78),
    // jamais réécrits ici.
    const isOwned =
      activePurchasesOf(book.purchases).length > 0 || activeOwnershipOf(book.ownerships ?? []) !== null;

    const finishedReadings = finishedReadingsOf(book.readings);

    for (const reading of finishedReadings) {
      // Depuis #101, une lecture terminée peut n'avoir AUCUNE date (« déjà lu »,
      // l'étagère d'avant). Elle est un fait de lecture — elle compte dans les
      // totaux — mais n'appartient à aucun mois : tout ce qui se date l'ignore,
      // plutôt que de lui inventer une place dans le temps.
      const finishedAt = reading.finishedAt;

      // Chaque lecture est un fait : une relecture compte deux fois ici
      // (volume, répartitions, notes) — mais une seule dans la pile, où la
      // règle « une sortie par livre » vit dans derivePileStatus.
      finishedTotal += 1;
      finishedByCategory[book.category] += 1;
      const inCurrentMonth = finishedAt !== null && monthOf(finishedAt) === currentMonth;
      const inCurrentYear = finishedAt !== null && yearOf(finishedAt) === currentYear;
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

      // — Lot A, le rythme : une durée n'est mesurable que si le début est
      // connu ET antérieur ou égal à la fin (une saisie incohérente ne compte
      // pas comme « 0 jour », elle rejoint le dénominateur des non datées).
      if (finishedAt !== null && reading.startedAt !== null && reading.startedAt <= finishedAt) {
        const duration = daysBetween(reading.startedAt, finishedAt);
        durationOverall.sum += duration;
        durationOverall.count += 1;
        durationByCategory[book.category].sum += duration;
        durationByCategory[book.category].count += 1;
      } else {
        readingsWithoutDuration += 1;
      }

      // — Lot D, le volume temporel : une fin, un mois. Sans date, aucun mois
      // à créditer (#101) — la courbe ne doit porter que du mesuré.
      if (finishedAt !== null) {
        const finishedMonth = monthOf(finishedAt);
        finishedCountByMonth.set(finishedMonth, (finishedCountByMonth.get(finishedMonth) ?? 0) + 1);
      }

      // — Lot C, les goûts avancés : seules les lectures NOTÉES pèsent. Les
      // moyennes par série et éditeur ne se datent pas : une lecture non datée
      // y compte normalement (la note est le fait, pas la date).
      if (reading.rating !== null) {
        if (book.seriesName !== null) addRating(ratingsBySeries, book.seriesName, reading.rating);
        if (book.publisher !== null) addRating(ratingsByPublisher, book.publisher, reading.rating);
        // Le classement, lui, AFFICHE la date de lecture : sans elle, la
        // lecture pèse dans les moyennes ci-dessus mais ne peut pas y figurer.
        if (finishedAt !== null) {
          ranking.push({
            bookId: book.id,
            title: book.title,
            category: book.category,
            rating: reading.rating,
            finishedAt,
          });
        }
      }

      // Jamais possédé = jamais dans la pile (§4.5) : cette lecture est un emprunt.
      if (!isOwned) readOutsidePalCount += 1;
    }

    // — Lot B, les tomes lus par série : on compte des LIVRES, pas des lectures
    // (une relecture ne fait pas apparaître un tome de plus dans la série).
    if (book.seriesName !== null && finishedReadings.length > 0) {
      volumesReadBySeries.set(book.seriesName, (volumesReadBySeries.get(book.seriesName) ?? 0) + 1);
    }

    // — Lot B, le tome suivant : on retient le tome LU relié à GCD (même règle
    // que ci-dessus, un livre = un tome). Le croisement avec la numérotation de
    // la série se fait après la passe, contre le catalogue fourni.
    if (book.gcdIssueId != null && finishedReadings.length > 0) {
      readVolumes.push({ gcdIssueId: book.gcdIssueId, seriesName: book.seriesName });
    }

    // — Lot A, les lectures qui traînent : en cours depuis plus de N jours, à la
    // date du jour FOURNIE (jamais lue d'une horloge ici). Sans `today`, on ne
    // sait rien dater : la liste reste vide plutôt que de mentir.
    if (today !== undefined) {
      for (const reading of inProgressReadingsOf(book.readings)) {
        if (reading.startedAt === null) continue;
        const daysSinceStart = daysBetween(reading.startedAt, today);
        if (daysSinceStart <= STALLED_READING_DAYS) continue;
        stalledReadings.push({
          bookId: book.id,
          title: book.title,
          category: book.category,
          startedAt: reading.startedAt,
          daysSinceStart,
        });
      }
    }

    // La règle de pile — importée, jamais ré-implémentée : le réducteur
    // partagé (achats actifs + fins terminées → derivePileStatus, #78) rend
    // une entrée et au plus une sortie par livre.
    const movement = bookToMovement(book);
    if (movement === null) continue;
    if (movement.entryDate !== null) palEntryDates.push(movement.entryDate);
    else palUndatedEntryCount += 1;
    if (movement.exited) {
      if (movement.exitDate !== null) palExitDates.push(movement.exitDate);
      else palUndatedExitCount += 1;
    }
  }

  // Taille de pile et solde du mois : la dérivation PARTAGÉE (lib/pal/health),
  // pour que les stats, la vue PAL et le bilan racontent la même histoire (§4.5).
  const health = computePalHealth(
    {
      entryDates: palEntryDates,
      exitDates: palExitDates,
      undatedEntryCount: palUndatedEntryCount,
      undatedExitCount: palUndatedExitCount,
    },
    currentMonth,
  );

  // La courbe cumulée : +1 au mois d'entrée, −1 au mois de sortie, mois à
  // mouvement triés, cumul chronologique.
  const pileDeltaByMonth = new Map<Month, number>();
  for (const entryDate of palEntryDates) {
    const entryMonth = monthOf(entryDate);
    pileDeltaByMonth.set(entryMonth, (pileDeltaByMonth.get(entryMonth) ?? 0) + 1);
  }
  for (const exitDate of palExitDates) {
    const exitMonth = monthOf(exitDate);
    pileDeltaByMonth.set(exitMonth, (pileDeltaByMonth.get(exitMonth) ?? 0) - 1);
  }

  // Les mouvements NON DATÉS (« je possède » / « déjà lu » sans date, #101)
  // n'appartiennent à aucun mois : ils forment une LIGNE DE BASE, le niveau de
  // la pile avant le premier mois mesurable — l'étagère d'avant, en somme.
  // C'est ce qui garde l'invariant : le dernier point de la courbe vaut
  // toujours `health.pileSize`, quelle que soit la part de non-daté.
  const baseline = palUndatedEntryCount - palUndatedExitCount;
  let runningSize = baseline;
  const cumulativeByMonth = [...pileDeltaByMonth.keys()].sort().map((month) => {
    runningSize += pileDeltaByMonth.get(month)!;
    return { month, size: runningSize };
  });

  // — Lot A, la liste calme : la lecture la plus ancienne en tête (celle qui
  // traîne le plus), le titre départage pour un rendu stable.
  stalledReadings.sort(
    (left, right) => right.daysSinceStart - left.daysSinceStart || left.title.localeCompare(right.title),
  );

  // — Lot A, abandons & reprises : l'agrégation PARTAGÉE de l'étape 1, jamais
  // ré-implémentée ici. On la remet à plat en une liste triée par mois, la
  // forme que les vues savent afficher (comme la courbe de PAL).
  const eventSummary = summarizeReadingEvents(readingEvents ?? []);
  const eventMonths = [
    ...new Set([...Object.keys(eventSummary.abandonsByMonth), ...Object.keys(eventSummary.resumptionsByMonth)]),
  ].sort();
  const eventsByMonth: MonthlyEventCounts[] = eventMonths.map((month) => ({
    month,
    abandons: eventSummary.abandonsByMonth[month] ?? 0,
    resumptions: eventSummary.resumptionsByMonth[month] ?? 0,
  }));

  // — Lot D : la série mensuelle, sa moyenne sur les mois ÉCOULÉS (vides
  // compris) et le meilleur mois (égalité → le plus ancien, l'ordre croissant
  // suffit à le garantir).
  const finishedByMonth = [...finishedCountByMonth.keys()]
    .sort()
    .map((month) => ({ month, count: finishedCountByMonth.get(month)! }));
  let bestMonth: MonthlyReport["bestMonth"] = null;
  for (const point of finishedByMonth) {
    if (bestMonth === null || point.count > bestMonth.count) bestMonth = point;
  }
  const elapsedMonths =
    finishedByMonth.length === 0 ? 0 : Math.max(1, monthsBetween(finishedByMonth[0].month, currentMonth));
  const averagePerMonth = elapsedMonths === 0 ? null : finishedTotal / elapsedMonths;

  const volumesRead = [...volumesReadBySeries.entries()]
    .map(([seriesName, count]) => ({ seriesName, count }))
    .sort((left, right) => right.count - left.count || left.seriesName.localeCompare(right.seriesName));

  // — Lot C : note DESC, puis la fin la plus RÉCENTE, puis le titre (tri total,
  // donc rendu stable d'un calcul à l'autre).
  ranking.sort(
    (left, right) =>
      right.rating - left.rating ||
      right.finishedAt.localeCompare(left.finishedAt) ||
      left.title.localeCompare(right.title),
  );

  const byPublisher = [...countByPublisher.entries()]
    .map(([publisher, count]) => ({ publisher, count }))
    .sort((left, right) => right.count - left.count || left.publisher.localeCompare(right.publisher));

  return {
    pal: {
      currentSize: health.pileSize,
      monthEntries: health.monthEntries,
      monthExits: health.monthExits,
      monthBalance: health.monthBalance,
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
      // Copie défensive : même contenu que le volume, sans partager la référence.
      byCategory: { ...finishedByCategory },
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
    rythme: {
      averageDurationDays: averageOf(durationOverall),
      averageDurationByCategory: Object.fromEntries(
        ALL_CATEGORIES.map((category) => [category, averageOf(durationByCategory[category])]),
      ) as Record<BookCategory, number | null>,
      readingsWithoutDuration,
      stalledReadings,
      eventsByMonth,
    },
    series: {
      volumesRead,
      // Le compte des tomes lus n'est pas recalculé : la dérivation du tome
      // suivant lit `volumesReadBySeries`, celui de la répartition ci-dessus.
      inProgress: deriveSeriesProgress(readVolumes, seriesCatalog ?? EMPTY_SERIES_CATALOG, volumesReadBySeries),
    },
    tastes: {
      series: rankGroups(ratingsBySeries),
      publishers: rankGroups(ratingsByPublisher),
      ranking,
    },
    monthly: { finishedByMonth, averagePerMonth, bestMonth },
  };
}
