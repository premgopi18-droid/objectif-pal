/**
 * La progression dans une série — lus · dans la pile · total (lot A de
 * l'epic #289, specs §4.17). Module PUR : les faits entrent (livres reliés à
 * une série, leurs lectures, achats, possessions ; le fait de série déclaré ;
 * l'indice GCD), la progression sort. Rien n'est stocké : la même règle de
 * pile que la PAL (`derivePileStatus`, §4.6/§4.13) dit qui est « dans la
 * pile », une lecture terminée dit qui est « lu ».
 *
 * Le principe qui gouverne tout : un tome faux serait pire qu'un tome absent.
 * Dès qu'un tome LU n'a pas de numéro exploitable, la jauge et le suivant se
 * taisent (« ≈ approximatif ») plutôt que de mentir.
 */

import type { BookCategory } from "@/lib/scoring/types";
import {
  activeOwnershipOf,
  activePurchasesOf,
  derivePileStatus,
  finishedDatesOf,
  finishedReadingsOf,
  isInPileNow,
  type OwnershipFact,
  type PurchaseFact,
  type ReadingFact,
} from "@/lib/pal/derive-pal";
import { parseVolumeNumber } from "@/lib/resolution/volume-number";

/** La ligne du référentiel partagé, telle que la page la lit. */
export type SeriesFact = {
  id: string;
  name: string;
  category: BookCategory;
  totalVolumes: number | null;
  isOngoing: boolean;
  factDeclaredBy: string | null;
  factDeclaredAt: string | null;
  /** Qui a posé le fait : un membre, ou la synchronisation GCD (série close / en cours chez GCD). */
  factSource: "human" | "gcd";
};

/** Un livre de l'utilisateur relié à une série, avec ses faits. */
export type SeriesBookFact = {
  id: string;
  seriesId: string;
  title: string;
  /** La catégorie du LIVRE — la série affiche celle de la majorité (review #295 : `series.category` n'est jamais révisée). */
  category: BookCategory;
  issueNumber: string | null;
  coverUrl: string | null;
  purchases: PurchaseFact[];
  readings: ReadingFact[];
  ownerships: OwnershipFact[];
};

export type SeriesVolumeState = "read" | "pile" | "other";

/**
 * Un plancher vivant (§4.17-4, #299) : le plus grand numéro connu chez une
 * source — notre import GCD, ou une édition déposée à la BnF (`label` =
 * l'éditeur). Jamais une vérité : il pré-remplit et signale, c'est tout.
 */
export type KnownMax = { source: "gcd" | "bnf"; value: number; label: string | null };

export type SeriesVolume = {
  bookId: string;
  title: string;
  coverUrl: string | null;
  /** Le numéro canonique, ou `null` quand il n'est pas exploitable. */
  number: number | null;
  state: SeriesVolumeState;
};

export type SeriesNext =
  /** Le prochain à lire est dans la pile. */
  | { kind: "read-next"; number: number; bookId: string }
  /** Le prochain à lire n'est pas possédé. */
  | { kind: "missing"; number: number }
  /** Parution en cours, tout le possédé est lu. */
  | { kind: "up-to-date" }
  /** Total déclaré atteint. */
  | { kind: "complete" };

export type SeriesStatus = "in-progress" | "up-to-date" | "complete" | "unknown-total" | "approximate";

export type SeriesProgress = {
  seriesId: string;
  name: string;
  category: BookCategory;
  read: number;
  pile: number;
  /** Tomes LUS sans numéro exploitable — au premier, la progression se tait. */
  unnumberedRead: number;
  readNumbers: number[];
  pileNumbers: number[];
  totalVolumes: number | null;
  isOngoing: boolean;
  factDeclaredBy: string | null;
  factDeclaredAt: string | null;
  factSource: "human" | "gcd";
  /** Les planchers vivants (§4.17-4, #299) : GCD et éditions BnF, du plus grand au plus petit. */
  knownMax: KnownMax[];
  /** La grille des tomes va de 1 à là. */
  gridMax: number;
  /** Les tomes 1..total ni lus ni dans la pile — `null` sans total déclaré (on ne sait pas ce qui manque). */
  missing: number | null;
  next: SeriesNext | null;
  status: SeriesStatus;
  /** Le seuil d'apparition (§4.17-6) : deux livres, ou un fait déclaré. */
  isVisible: boolean;
  volumes: SeriesVolume[];
};

/** Deux livres, ou un livre et un fait déclaré (§4.17-6). */
export const MIN_BOOKS_TO_SHOW_SERIES = 2;

const volumeState = (book: SeriesBookFact): SeriesVolumeState => {
  if (finishedReadingsOf(book.readings).length > 0) return "read";
  const ownership = activeOwnershipOf(book.ownerships);
  const status = derivePileStatus({
    purchaseDates: activePurchasesOf(book.purchases).map((purchase) => purchase.purchasedAt),
    ownership: ownership ? { ownedSince: ownership.ownedSince, disposedAt: ownership.disposedAt } : null,
    finishedDates: finishedDatesOf(book.readings),
    hasUndatedFinish: false,
  });
  return isInPileNow(status) ? "pile" : "other";
};

const toVolume = (book: SeriesBookFact): SeriesVolume => {
  const parsed = parseVolumeNumber(book.issueNumber);
  return {
    bookId: book.id,
    title: book.title,
    coverUrl: book.coverUrl,
    number: parsed === null ? null : Number(parsed),
    state: volumeState(book),
  };
};

const sortedUnique = (numbers: number[]): number[] => [...new Set(numbers)].sort((left, right) => left - right);

/** La catégorie de la majorité des tomes de l'utilisateur (égalité : la première rencontrée). */
const majorityCategory = (books: SeriesBookFact[]): BookCategory | null => {
  const counts = new Map<BookCategory, number>();
  for (const book of books) counts.set(book.category, (counts.get(book.category) ?? 0) + 1);
  let best: BookCategory | null = null;
  let bestCount = 0;
  for (const [category, count] of counts) {
    if (count > bestCount) {
      best = category;
      bestCount = count;
    }
  }
  return best;
};

/** La progression d'UNE série à partir de ses tomes chez l'utilisateur. */
export function deriveSeriesProgress(
  series: SeriesFact,
  books: SeriesBookFact[],
  knownMax: readonly KnownMax[] = [],
): SeriesProgress {
  const volumes = books
    .map(toVolume)
    .sort((left, right) => (left.number ?? Number.MAX_SAFE_INTEGER) - (right.number ?? Number.MAX_SAFE_INTEGER));

  const readVolumes = volumes.filter((volume) => volume.state === "read");
  const pileVolumes = volumes.filter((volume) => volume.state === "pile");
  const unnumberedRead = readVolumes.filter((volume) => volume.number === null).length;
  const readNumbers = sortedUnique(readVolumes.flatMap((volume) => (volume.number === null ? [] : [volume.number])));
  const pileNumbers = sortedUnique(pileVolumes.flatMap((volume) => (volume.number === null ? [] : [volume.number])));
  const ownedMax = Math.max(0, ...readNumbers, ...pileNumbers);
  const gridMax = series.totalVolumes ?? ownedMax;
  const hasFact = series.factDeclaredAt !== null;
  const owned = new Set([...readNumbers, ...pileNumbers]);
  const missing =
    series.totalVolumes === null
      ? null
      : Array.from({ length: series.totalVolumes }, (_, index) => index + 1).filter((number) => !owned.has(number)).length;

  const next = resolveNext({ series, readNumbers, pileNumbers, pileVolumes, gridMax, unnumberedRead });

  let status: SeriesStatus;
  if (unnumberedRead > 0) status = "approximate";
  else if (next?.kind === "complete") status = "complete";
  else if (next?.kind === "up-to-date") status = "up-to-date";
  else if (series.totalVolumes === null && !series.isOngoing) status = "unknown-total";
  else status = "in-progress";

  return {
    seriesId: series.id,
    name: series.name,
    category: majorityCategory(books) ?? series.category,
    read: readVolumes.length,
    pile: pileVolumes.length,
    unnumberedRead,
    readNumbers,
    pileNumbers,
    totalVolumes: series.totalVolumes,
    isOngoing: series.isOngoing,
    factDeclaredBy: series.factDeclaredBy,
    factDeclaredAt: series.factDeclaredAt,
    factSource: series.factSource,
    knownMax: [...knownMax].sort((left, right) => right.value - left.value),
    gridMax,
    missing,
    next,
    status,
    // Ce que la carte affiche (lus + pile) décide de l'apparition — deux tomes
    // cédés ne font pas une série à suivre (review #295). Un tome isolé n'y
    // entre que sur un fait HUMAIN : la synchronisation GCD déclare des
    // centaines de séries, elle ne doit pas peupler le segment de singletons
    // (vécu sur « Ippo », 14/09/2026).
    isVisible:
      readVolumes.length + pileVolumes.length >= MIN_BOOKS_TO_SHOW_SERIES || (hasFact && series.factSource === "human"),
    volumes,
  };
}

/**
 * Le tome suivant = le plus petit numéro non lu (règle de #30, §4.17-8) :
 * « à lire » s'il est dans la pile, « il te manque » sinon. Silence si un
 * tome lu n'a pas de numéro. « Complète » seulement avec un total déclaré ;
 * « À jour » seulement en parution en cours, quand tout le possédé est lu.
 */
function resolveNext(input: {
  series: SeriesFact;
  readNumbers: number[];
  pileNumbers: number[];
  pileVolumes: SeriesVolume[];
  gridMax: number;
  unnumberedRead: number;
}): SeriesNext | null {
  const { series, readNumbers, pileNumbers, pileVolumes, gridMax, unnumberedRead } = input;
  if (unnumberedRead > 0) return null;

  const read = new Set(readNumbers);
  const inPile = new Set(pileNumbers);
  // « Complète » = les tomes 1..total sont lus. Un tome 0 (prologue, #0 des
  // comics) ne compte pas dans le total (review #295).
  const totalVolumes = series.totalVolumes;
  if (totalVolumes !== null && readNumbers.filter((number) => number >= 1 && number <= totalVolumes).length >= totalVolumes) {
    return { kind: "complete" };
  }
  for (let number = 1; number <= gridMax; number += 1) {
    if (read.has(number)) continue;
    if (inPile.has(number)) {
      const volume = pileVolumes.find((candidate) => candidate.number === number);
      return { kind: "read-next", number, bookId: volume?.bookId ?? "" };
    }
    return { kind: "missing", number };
  }
  if (series.isOngoing && pileVolumes.length === 0) return { kind: "up-to-date" };
  return null;
}

/** La moisson pour les Stats (lot C, maquette cadran B) : compteurs, dette, à lire ensuite. */
export type SeriesSummary = {
  inProgress: number;
  upToDate: number;
  complete: number;
  /** Les tomes possédés pas lus, toutes séries visibles confondues. */
  debt: number;
  /** Les plus grosses dettes, décroissantes. */
  topDebt: { seriesId: string; name: string; pile: number }[];
  /** Les tomes suivants connus — dans la pile ou à acheter. */
  nextToRead: { seriesId: string; name: string; coverUrl: string | null; next: Extract<SeriesNext, { kind: "read-next" | "missing" }>; read: number; totalVolumes: number | null }[];
};

export const SERIES_SUMMARY_LIST_LIMIT = 5;

/** Agrège une liste déjà filtrée au seuil (`deriveSeries`) — pur, borné. */
export function summarizeSeries(list: readonly SeriesProgress[]): SeriesSummary {
  const counted = (status: SeriesStatus) => list.filter((progress) => progress.status === status).length;
  const nextToRead = list.flatMap((progress) => {
    const next = progress.next;
    if (next === null || (next.kind !== "read-next" && next.kind !== "missing")) return [];
    const cover = progress.volumes.find((volume) => volume.state !== "other")?.coverUrl ?? null;
    return [{ seriesId: progress.seriesId, name: progress.name, coverUrl: cover, next, read: progress.read, totalVolumes: progress.totalVolumes }];
  });
  return {
    inProgress: counted("in-progress") + counted("unknown-total") + counted("approximate"),
    upToDate: counted("up-to-date"),
    complete: counted("complete"),
    debt: list.reduce((sum, progress) => sum + progress.pile, 0),
    topDebt: list
      .filter((progress) => progress.pile > 0)
      .slice()
      .sort((left, right) => right.pile - left.pile || left.name.localeCompare(right.name, "fr"))
      .slice(0, SERIES_SUMMARY_LIST_LIMIT)
      .map((progress) => ({ seriesId: progress.seriesId, name: progress.name, pile: progress.pile })),
    // Ceux qui sont dans la pile d'abord (on peut lire ce soir), puis les manquants.
    nextToRead: nextToRead
      .sort((left, right) => Number(right.next.kind === "read-next") - Number(left.next.kind === "read-next"))
      .slice(0, SERIES_SUMMARY_LIST_LIMIT),
  };
}

/** Les livres « à lire ensuite » déjà dans la pile — le vivier du mode « on continue une série » de la roulette (§4.16). */
export function nextInPileBookIds(list: readonly SeriesProgress[]): Set<string> {
  return new Set(list.flatMap((progress) => (progress.next?.kind === "read-next" ? [progress.next.bookId] : [])));
}

/** Toutes les séries de l'utilisateur, triées par dette décroissante (la plus grosse dette d'abord — c'est elle qu'on vient regarder). */
export function deriveSeries(
  seriesList: SeriesFact[],
  books: SeriesBookFact[],
  knownMaxBySeriesId: ReadonlyMap<string, readonly KnownMax[]> = new Map(),
): SeriesProgress[] {
  const booksBySeries = new Map<string, SeriesBookFact[]>();
  for (const book of books) booksBySeries.set(book.seriesId, [...(booksBySeries.get(book.seriesId) ?? []), book]);

  return seriesList
    .map((series) =>
      deriveSeriesProgress(series, booksBySeries.get(series.id) ?? [], knownMaxBySeriesId.get(series.id) ?? []),
    )
    .filter((progress) => progress.isVisible)
    .sort((left, right) => right.pile - left.pile || right.read - left.read || left.name.localeCompare(right.name, "fr"));
}
