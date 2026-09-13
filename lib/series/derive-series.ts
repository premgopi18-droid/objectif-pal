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
};

/** Un livre de l'utilisateur relié à une série, avec ses faits. */
export type SeriesBookFact = {
  id: string;
  seriesId: string;
  title: string;
  issueNumber: string | null;
  coverUrl: string | null;
  purchases: PurchaseFact[];
  readings: ReadingFact[];
  ownerships: OwnershipFact[];
};

export type SeriesVolumeState = "read" | "pile" | "other";

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
  /** Le plus grand numéro connu par notre import GCD (indice vivant, §4.17-4), ou `null`. */
  gcdKnownMax: number | null;
  /** La grille des tomes va de 1 à là. */
  gridMax: number;
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

/** La progression d'UNE série à partir de ses tomes chez l'utilisateur. */
export function deriveSeriesProgress(
  series: SeriesFact,
  books: SeriesBookFact[],
  gcdKnownMax: number | null = null,
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
    category: series.category,
    read: readVolumes.length,
    pile: pileVolumes.length,
    unnumberedRead,
    readNumbers,
    pileNumbers,
    totalVolumes: series.totalVolumes,
    isOngoing: series.isOngoing,
    factDeclaredBy: series.factDeclaredBy,
    factDeclaredAt: series.factDeclaredAt,
    gcdKnownMax,
    gridMax,
    next,
    status,
    // Ce que la carte affiche (lus + pile) décide de l'apparition — deux tomes
    // cédés ne font pas une série à suivre (review #295).
    isVisible: readVolumes.length + pileVolumes.length >= MIN_BOOKS_TO_SHOW_SERIES || hasFact,
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

/** Toutes les séries de l'utilisateur, triées par dette décroissante (la plus grosse dette d'abord — c'est elle qu'on vient regarder). */
export function deriveSeries(
  seriesList: SeriesFact[],
  books: SeriesBookFact[],
  gcdKnownMaxBySeriesId: ReadonlyMap<string, number> = new Map(),
): SeriesProgress[] {
  const booksBySeries = new Map<string, SeriesBookFact[]>();
  for (const book of books) booksBySeries.set(book.seriesId, [...(booksBySeries.get(book.seriesId) ?? []), book]);

  return seriesList
    .map((series) =>
      deriveSeriesProgress(series, booksBySeries.get(series.id) ?? [], gcdKnownMaxBySeriesId.get(series.id) ?? null),
    )
    .filter((progress) => progress.isVisible)
    .sort((left, right) => right.pile - left.pile || right.read - left.read || left.name.localeCompare(right.name, "fr"));
}
