import { classifyScannedCode } from "./barcode-router";
import {
  guessCategoryFromGoogleBooksCategories,
  guessCategoryFromMetronSeriesType,
  guessCategoryFromPublisher,
} from "./guess-category";
import { createBnfProvider, type BnfProvider } from "./providers/bnf";
import { createCacheProvider, type CacheProvider } from "./providers/cache";
import {
  createGcdProvider,
  GCD_LANGUAGE_FRENCH,
  type GcdIssue,
  type GcdProvider,
  type GcdSeries,
} from "./providers/gcd";
import { createGoogleBooksProvider, type GoogleBooksProvider } from "./providers/google-books";
import { createMetronProvider, type MetronProvider } from "./providers/metron";
import type { CacheEntry, ResolvedBook, ScanLookupResult } from "./types";

/**
 * La cascade de résolution — specs §5.2 :
 *
 *   GCD (en base) → BnF → Google Books → Metron → saisie manuelle (côté UI).
 *
 * Chaque source apporte ce qu'aucune autre n'a ; chaque échec (réseau, quota,
 * introuvable) fait descendre d'un cran : LE SCAN NE PEUT PAS ÉCHOUER (§8).
 * Toute résolution externe part dans `barcode_cache`, définitivement.
 */

export type ResolutionDeps = {
  gcd: GcdProvider;
  bnf: BnfProvider;
  googleBooks: GoogleBooksProvider;
  metron: MetronProvider;
  cache: CacheProvider;
};

export function createDefaultDeps(): ResolutionDeps {
  return {
    gcd: createGcdProvider(),
    bnf: createBnfProvider(),
    googleBooks: createGoogleBooksProvider(),
    metron: createMetronProvider(),
    cache: createCacheProvider(),
  };
}

/** Un appel externe ne doit jamais faire tomber la cascade : erreur = absence. */
async function attempt<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    console.error("[resolution] source en échec, on descend d'un cran :", error);
    return null;
  }
}

const fromCache = (entry: CacheEntry, barcodeType: "isbn" | "upc"): ResolvedBook => ({
  title: entry.title,
  seriesName: entry.seriesName,
  issueNumber: entry.issueNumber,
  authors: entry.authors,
  publisher: entry.publisher,
  pageCount: entry.pageCount,
  coverUrl: entry.coverUrl,
  // Le cache ne stocke pas de catégorie : on la re-devine (déterministe) —
  // et la correction de l'utilisateur fait foi de toute façon au moment de créer le livre.
  suggestedCategory: guessCategoryFromPublisher(entry.publisher) ?? (barcodeType === "upc" ? "issue" : "roman"),
  source: entry.source,
  sourceId: entry.sourceId,
  barcodeType,
});

/** Construit un livre depuis une issue GCD (avec sa série si connue). */
function fromGcdIssue(issue: GcdIssue, series: GcdSeries | undefined, barcodeType: "isbn" | "upc"): ResolvedBook {
  // Un UPC est un fascicule ; un ISBN chez GCD : BD si la série est française,
  // sinon recueil VO (TPB) — Metron affinera avec series_type (omnibus…).
  const suggestedCategory =
    barcodeType === "upc" ? "issue" : series?.languageId === GCD_LANGUAGE_FRENCH ? "bd" : "comics";
  return {
    title: issue.title || null,
    seriesName: series?.name ?? null,
    issueNumber: issue.number || null,
    authors: null, // le dump réduit ne porte pas les crédits
    publisher: series?.publisher ?? null,
    pageCount: issue.pageCount,
    coverUrl: null, // le dump n'a pas les couvertures (specs §5.4)
    suggestedCategory,
    source: "gcd",
    sourceId: String(issue.gcdId),
    barcodeType,
  };
}

/** Enrichissement VO : couverture + series_type, sans jamais bloquer (specs §5.4). */
async function enrichWithMetron(book: ResolvedBook, deps: ResolutionDeps, upc: string | null): Promise<ResolvedBook> {
  const metronIssue = await attempt(async () => {
    if (book.sourceId && book.source === "gcd") {
      const byGcdId = await deps.metron.findIssueByGcdId(Number(book.sourceId));
      if (byGcdId) return byGcdId;
    }
    return upc ? deps.metron.findIssueByUpc(upc) : null;
  });
  if (!metronIssue) return book;

  return {
    ...book,
    coverUrl: book.coverUrl ?? metronIssue.coverUrl,
    pageCount: book.pageCount ?? metronIssue.pageCount,
    suggestedCategory: guessCategoryFromMetronSeriesType(metronIssue.seriesType) ?? book.suggestedCategory,
  };
}

/** Enrichissement VF : la couverture Google Books, sans jamais bloquer. */
async function enrichCoverWithGoogleBooks(book: ResolvedBook, deps: ResolutionDeps, isbn: string): Promise<ResolvedBook> {
  if (book.coverUrl) return book;
  const record = await attempt(() => deps.googleBooks.resolveIsbn(isbn));
  return record?.coverUrl ? { ...book, coverUrl: record.coverUrl } : book;
}

/** La résolution d'un ISBN : GCD → BnF → Google Books (specs §5.2). */
async function resolveIsbn(raw: string, ean13: string, isbnCandidates: string[], deps: ResolutionDeps): Promise<ScanLookupResult> {
  // 1. Notre cache — un bouquin n'est jamais résolu deux fois.
  const cached = await attempt(() => deps.cache.get(raw));
  if (cached) return { kind: "resolved", book: fromCache(cached, "isbn") };

  // 2. GCD, en base : comics VO (TPB, omnibus) et BD franco-belge.
  const gcdIssues = await attempt(() => deps.gcd.findIssuesByIsbn(isbnCandidates));
  if (gcdIssues && gcdIssues.length > 0) {
    const issue = gcdIssues[0];
    const seriesById = await attempt(() => deps.gcd.getSeriesByIds([issue.seriesId]));
    const book = fromGcdIssue(issue, seriesById?.get(issue.seriesId), "isbn");
    const enriched =
      book.suggestedCategory === "bd"
        ? await enrichCoverWithGoogleBooks(book, deps, ean13)
        : await enrichWithMetron(book, deps, null);
    return { kind: "resolved", book: enriched };
  }

  // 3. BnF : le dépôt légal identifie la VF (manga, roman, BD absente de GCD).
  const bnfRecord = await attempt(() => deps.bnf.resolveIsbn(ean13));
  if (bnfRecord) {
    let book: ResolvedBook = {
      title: bnfRecord.title,
      seriesName: bnfRecord.seriesName,
      issueNumber: bnfRecord.issueNumber,
      authors: bnfRecord.authors,
      publisher: bnfRecord.publisher,
      pageCount: bnfRecord.pageCount,
      coverUrl: null, // la BnF n'illustre pas
      suggestedCategory: guessCategoryFromPublisher(bnfRecord.publisher) ?? "roman",
      source: "bnf",
      sourceId: ean13,
      barcodeType: "isbn",
    };
    book = await enrichCoverWithGoogleBooks(book, deps, ean13);
    await attempt(() => deps.cache.set(toCacheEntry(raw, book, "bnf")));
    return { kind: "resolved", book };
  }

  // 4. Google Books : les romans étrangers, dernier identifiant.
  const googleRecord = await attempt(() => deps.googleBooks.resolveIsbn(ean13));
  if (googleRecord) {
    const book: ResolvedBook = {
      title: googleRecord.title,
      seriesName: null,
      issueNumber: null,
      authors: googleRecord.authors,
      publisher: googleRecord.publisher,
      pageCount: googleRecord.pageCount,
      coverUrl: googleRecord.coverUrl,
      suggestedCategory:
        guessCategoryFromPublisher(googleRecord.publisher) ??
        guessCategoryFromGoogleBooksCategories(googleRecord.categories) ??
        "roman",
      source: "google_books",
      sourceId: googleRecord.volumeId,
      barcodeType: "isbn",
    };
    await attempt(() => deps.cache.set(toCacheEntry(raw, book, "google_books")));
    return { kind: "resolved", book };
  }

  return { kind: "not-found" };
}

/** La résolution d'un UPC : GCD exact → préfixe → Metron (nouveautés). */
async function resolveUpc(raw: string, base: string, deps: ResolutionDeps): Promise<ScanLookupResult> {
  const cached = await attempt(() => deps.cache.get(raw));
  if (cached) return { kind: "resolved", book: fromCache(cached, "upc") };

  // 1. Match exact — GCD stocke souvent le code COMPLET (67 % avec supplément).
  const exactCodes = raw === base ? [raw] : [raw, base];
  const exactMatches = await attempt(() => deps.gcd.findIssuesByBarcode(exactCodes));
  if (exactMatches && exactMatches.length > 0) {
    const issue = exactMatches[0];
    const seriesById = await attempt(() => deps.gcd.getSeriesByIds([issue.seriesId]));
    const book = fromGcdIssue(issue, seriesById?.get(issue.seriesId), "upc");
    return { kind: "resolved", book: await enrichWithMetron(book, deps, raw) };
  }

  // 2. Par préfixe : les 12 premiers chiffres identifient le titre (93,9 % des
  //    préfixes ne pointent qu'une série — specs §6).
  const prefixMatches = await attempt(() => deps.gcd.findIssuesByPrefix(base));
  if (prefixMatches && prefixMatches.length > 0) {
    const seriesById = (await attempt(() => deps.gcd.getSeriesByIds(prefixMatches.map((issue) => issue.seriesId)))) ?? new Map();
    const seriesIds = [...new Set(prefixMatches.map((issue) => issue.seriesId))];

    if (seriesIds.length === 1) {
      // Série connue → « quel numéro ? », un tap.
      const series = seriesById.get(seriesIds[0]);
      return {
        kind: "pick-issue",
        seriesId: seriesIds[0],
        seriesName: series?.name ?? "Série inconnue",
        publisher: series?.publisher ?? null,
        issues: sortIssueCandidates(prefixMatches),
      };
    }

    // Préfixe partagé (promos, one-shots) → liste courte de séries, deux taps.
    return {
      kind: "pick-series",
      candidates: seriesIds.map((seriesId) => {
        const series = seriesById.get(seriesId);
        return {
          seriesId,
          seriesName: series?.name ?? "Série inconnue",
          publisher: series?.publisher ?? null,
          issueCount: prefixMatches.filter((issue) => issue.seriesId === seriesId).length,
        };
      }),
    };
  }

  // 3. Metron : les nouveautés que le dump n'a pas encore (specs §6) —
  //    et chaque succès enrichit notre base pour toujours.
  const metronIssue = await attempt(() => deps.metron.findIssueByUpc(raw));
  if (metronIssue) {
    const book: ResolvedBook = {
      title: metronIssue.issueName,
      seriesName: metronIssue.seriesName,
      issueNumber: metronIssue.number,
      authors: null,
      publisher: metronIssue.publisher,
      pageCount: metronIssue.pageCount,
      coverUrl: metronIssue.coverUrl,
      suggestedCategory: guessCategoryFromMetronSeriesType(metronIssue.seriesType) ?? "issue",
      source: "metron",
      sourceId: String(metronIssue.metronId),
      barcodeType: "upc",
    };
    await attempt(() => deps.cache.set(toCacheEntry(raw, book, "metron")));
    return { kind: "resolved", book };
  }

  return { kind: "not-found" };
}

const toCacheEntry = (barcode: string, book: ResolvedBook, source: CacheEntry["source"]): CacheEntry => ({
  barcode,
  title: book.title,
  seriesName: book.seriesName,
  issueNumber: book.issueNumber,
  authors: book.authors,
  publisher: book.publisher,
  pageCount: book.pageCount,
  coverUrl: book.coverUrl,
  source,
  sourceId: book.sourceId,
});

const sortIssueCandidates = (issues: GcdIssue[]) =>
  issues
    .map((issue) => ({ gcdId: issue.gcdId, number: issue.number, title: issue.title || null }))
    .sort((left, right) => {
      const leftNumber = Number(left.number);
      const rightNumber = Number(right.number);
      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
      return left.number.localeCompare(right.number);
    });

/** Le point d'entrée : un code scanné, un résultat — jamais d'exception. */
export async function resolveScannedCode(input: string, deps: ResolutionDeps = createDefaultDeps()): Promise<ScanLookupResult> {
  const code = classifyScannedCode(input);
  if (code.type === "invalid") return { kind: "invalid" };
  if (code.type === "isbn") return resolveIsbn(code.raw, code.ean13, code.isbnCandidates, deps);
  return resolveUpc(code.raw, code.base, deps);
}

/** Résout une issue GCD précise — après un choix dans une liste (pick). */
export async function resolveGcdIssue(gcdId: number, deps: ResolutionDeps = createDefaultDeps()): Promise<ScanLookupResult> {
  const issue = await attempt(() => deps.gcd.getIssueByGcdId(gcdId));
  if (!issue) return { kind: "not-found" };
  const seriesById = await attempt(() => deps.gcd.getSeriesByIds([issue.seriesId]));
  const barcodeType = issue.barcode ? "upc" : "isbn";
  const book = fromGcdIssue(issue, seriesById?.get(issue.seriesId), barcodeType);
  return { kind: "resolved", book: await enrichWithMetron(book, deps, issue.barcode) };
}
