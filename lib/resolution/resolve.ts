import { classifyScannedCode } from "./barcode-router";
import {
  guessCategoryFromGoogleBooksCategories,
  guessCategoryFromMetronSeriesType,
  guessCategoryFromPublisher,
} from "./guess-category";
import { createBnfProvider, type BnfProvider } from "./providers/bnf";
import { createBnfCoversProvider, type BnfCoversProvider } from "./providers/bnf-covers";
import { createCacheProvider, type CacheProvider } from "./providers/cache";
import { createEpagineProvider, type EpagineProvider } from "./providers/epagine";
import {
  createGcdProvider,
  GCD_LANGUAGE_FRENCH,
  type GcdIssue,
  type GcdProvider,
  type GcdSeries,
} from "./providers/gcd";
import { createGoogleBooksProvider, type GoogleBooksProvider } from "./providers/google-books";
import { createInventaireProvider, type InventaireProvider } from "./providers/inventaire";
import { createMetronProvider, type MetronIssue, type MetronProvider } from "./providers/metron";
import { createOpenLibraryProvider, type OpenLibraryProvider } from "./providers/open-library";
import { GCD_UNNUMBERED_ISSUE_NUMBER, type CacheEntry, type ResolvedBook, type ScanLookupResult } from "./types";

/**
 * La cascade de résolution — specs §5.2 :
 *
 *   GCD (en base) → BnF → Google Books → Metron → saisie manuelle (côté UI).
 *
 * Chaque source apporte ce qu'aucune autre n'a ; chaque échec (réseau, quota,
 * introuvable) fait descendre d'un cran : LE SCAN NE PEUT PAS ÉCHOUER (§8).
 * Toute résolution externe part dans `barcode_cache`, définitivement — y
 * compris l'ENRICHISSEMENT d'une résolution GCD (couverture Metron / Google
 * Books) : la ligne GCD est gratuite, ses 2-3 appels d'enrichissement non.
 *
 * La clé de cache est NORMALISÉE : l'EAN-13 pour un ISBN (le supplément de
 * 5 chiffres y est un PRIX — le même bouquin scanné avec ou sans doit tomber
 * sur la même entrée), le code brut pour un UPC (le supplément y est
 * SIGNIFIANT : numéro d'issue, couverture, tirage — specs §5.1).
 */

/**
 * Budget global de la cascade : au-delà, on arrête d'essayer les sources
 * restantes et on rend « non résolu » — l'UI bascule en saisie manuelle avec
 * le code scanné conservé. Trois providers à 4 s chacun peuvent sinon retenir
 * l'utilisateur ~12 s devant « Résolution en cours… » ; le cas normal mesuré
 * est 300-800 ms par appel (specs §8).
 */
const RESOLUTION_BUDGET_MILLISECONDS = 10_000;

const isBudgetExhausted = (startedAtMs: number) => Date.now() - startedAtMs >= RESOLUTION_BUDGET_MILLISECONDS;

export type ResolutionDeps = {
  gcd: GcdProvider;
  bnf: BnfProvider;
  googleBooks: GoogleBooksProvider;
  openLibrary: OpenLibraryProvider;
  inventaire: InventaireProvider;
  bnfCovers: BnfCoversProvider;
  epagine: EpagineProvider;
  metron: MetronProvider;
  cache: CacheProvider;
};

export function createDefaultDeps(): ResolutionDeps {
  return {
    gcd: createGcdProvider(),
    bnf: createBnfProvider(),
    googleBooks: createGoogleBooksProvider(),
    openLibrary: createOpenLibraryProvider(),
    inventaire: createInventaireProvider(),
    bnfCovers: createBnfCoversProvider(),
    epagine: createEpagineProvider(),
    metron: createMetronProvider(),
    cache: createCacheProvider(),
  };
}

/** Un appel externe ne doit jamais faire tomber la cascade : erreur = absence. */
async function attempt<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    // Jamais l'erreur brute : la cause d'une TypeError de fetch peut porter
    // l'URL complète — clé Google Books comprise (elle voyage en query param).
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[resolution] source en échec, on descend d'un cran : ${message}`);
    return null;
  }
}

const fromCache = (entry: CacheEntry, barcodeType: "isbn" | "upc"): ResolvedBook => ({
  title: entry.title,
  seriesName: entry.seriesName,
  // Ceinture-bretelles (review #59) : une entrée « [nn] » écrite hors de
  // l'app ne doit pas re-exposer le marqueur — même règle qu'à la résolution.
  issueNumber: entry.issueNumber === GCD_UNNUMBERED_ISSUE_NUMBER ? null : entry.issueNumber,
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
  barcode: entry.barcode,
  isbn: barcodeType === "isbn" ? entry.barcode.slice(0, 13) : null,
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
    // « [nn] » = sans numéro chez GCD (issue #58) : une absence, pas un numéro.
    issueNumber: issue.number === GCD_UNNUMBERED_ISSUE_NUMBER ? null : issue.number || null,
    authors: null, // le dump réduit ne porte pas les crédits
    publisher: series?.publisher ?? null,
    pageCount: issue.pageCount,
    coverUrl: null, // le dump n'a pas les couvertures (specs §5.4)
    suggestedCategory,
    source: "gcd",
    sourceId: String(issue.gcdId),
    barcodeType,
    barcode: issue.barcode,
    isbn: issue.isbn,
  };
}

/** Enrichissement VO : couverture + series_type, sans jamais bloquer (specs §5.4). */
async function enrichWithMetron(
  book: ResolvedBook,
  deps: ResolutionDeps,
  upc: string | null,
  startedAtMs: number,
): Promise<ResolvedBook> {
  // Budget épuisé : le livre est déjà identifié, on le rend sans l'habiller.
  if (isBudgetExhausted(startedAtMs)) return book;
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
async function enrichCoverWithGoogleBooks(
  book: ResolvedBook,
  deps: ResolutionDeps,
  isbn: string,
  startedAtMs: number,
): Promise<ResolvedBook> {
  if (book.coverUrl) return book;
  // Budget épuisé : le livre est déjà identifié, on le rend sans l'habiller.
  if (isBudgetExhausted(startedAtMs)) return book;
  const record = await attempt(() => deps.googleBooks.resolveIsbn(isbn));
  return record?.coverUrl ? { ...book, coverUrl: record.coverUrl } : book;
}

/**
 * Les crans de repli couverture par ISBN — OpenLibrary, Inventaire, BnF
 * Couvertures, puis epagine (specs §5.4, décisions des 19/07/2026) : gratuits,
 * sans clé, chacun croque dans le reliquat du précédent. epagine ferme la
 * marche : le mieux fourni en VF récente, mais le seul sans engagement
 * d'ouverture — on ne le sollicite que quand tout le reste a échoué.
 * La photo (#33) reste le filet ultime.
 */
async function findFallbackCoverByIsbn(
  deps: ResolutionDeps,
  isbn: string,
  startedAtMs: number,
): Promise<string | null> {
  const fallbacks = [deps.openLibrary, deps.inventaire, deps.bnfCovers, deps.epagine];
  for (const provider of fallbacks) {
    if (isBudgetExhausted(startedAtMs)) return null;
    const cover = await attempt(() => provider.findCoverByIsbn(isbn));
    if (cover) return cover;
  }
  return null;
}

/**
 * La chaîne complète de couverture pour un livre à ISBN : Google Books, puis
 * les replis. Rend le MÊME objet quand rien n'est trouvé (le contrat de
 * `cacheEnrichedGcdBook`).
 */
async function enrichCoverForIsbn(
  book: ResolvedBook,
  deps: ResolutionDeps,
  isbn: string,
  startedAtMs: number,
): Promise<ResolvedBook> {
  const withGoogle = await enrichCoverWithGoogleBooks(book, deps, isbn, startedAtMs);
  if (withGoogle.coverUrl) return withGoogle;
  const fallbackCover = await findFallbackCoverByIsbn(deps, isbn, startedAtMs);
  return fallbackCover ? { ...withGoogle, coverUrl: fallbackCover } : withGoogle;
}

/**
 * Met en cache une résolution GCD ENRICHIE — mais seulement si l'enrichissement
 * a rapporté quelque chose (les helpers rendent le MÊME objet quand la source
 * n'a rien donné) : un raté transitoire de Metron ou Google Books ne doit pas
 * figer un livre sans couverture pour toujours — on retentera au prochain scan.
 * La résolution GCD elle-même est gratuite (en base), elle n'a pas besoin du cache.
 */
async function cacheEnrichedGcdBook(
  cacheKey: string,
  book: ResolvedBook,
  enriched: ResolvedBook,
  deps: ResolutionDeps,
): Promise<void> {
  if (enriched === book) return;
  await attempt(() => deps.cache.set(toCacheEntry(cacheKey, enriched, "gcd")));
}

/**
 * L'échec d'identification d'un ISBN tente quand même la couverture (issue
 * #55) : les libraires distribuent des livres qu'aucune base bibliographique
 * ne connaît (mesuré : l'auto-édition française). L'image pré-remplit la
 * saisie manuelle — l'utilisateur fournit le reste. Le budget global
 * s'applique : épuisé, la chaîne rend null immédiatement.
 */
async function notFoundForIsbn(deps: ResolutionDeps, ean13: string, startedAtMs: number): Promise<ScanLookupResult> {
  return { kind: "not-found", coverUrl: await findFallbackCoverByIsbn(deps, ean13, startedAtMs) };
}

/** La résolution d'un ISBN : GCD → BnF → Google Books (specs §5.2). */
async function resolveIsbn(
  raw: string,
  ean13: string,
  isbnCandidates: string[],
  deps: ResolutionDeps,
  startedAtMs: number,
): Promise<ScanLookupResult> {
  // 1. Notre cache — un bouquin n'est jamais résolu deux fois. La clé est
  //    l'EAN-13, PAS le code brut : scanné avec puis sans le supplément prix
  //    (18 vs 13 chiffres), c'est le même livre — une seule entrée.
  const cached = await attempt(() => deps.cache.get(ean13));
  if (cached) {
    let book = fromCache(cached, "isbn");
    // Une entrée SANS couverture n'est pas figée pour autant : les crans de
    // repli s'étoffent avec le temps (specs §5.4) et une source muette un jour
    // peut répondre le lendemain — on retente la chaîne, et si elle rapporte,
    // on RÉPARE l'entrée pour que les scans suivants en profitent gratuitement.
    if (!book.coverUrl) {
      book = await enrichCoverForIsbn(book, deps, ean13, startedAtMs);
      if (book.coverUrl) await attempt(() => deps.cache.set(toCacheEntry(ean13, book, cached.source)));
    }
    return { kind: "resolved", book };
  }

  // 2. GCD, en base : comics VO (TPB, omnibus) et BD franco-belge.
  const gcdIssues = await attempt(() => deps.gcd.findIssuesByIsbn(isbnCandidates));
  if (gcdIssues && gcdIssues.length > 0) {
    const issue = gcdIssues[0];
    const seriesById = await attempt(() => deps.gcd.getSeriesByIds([issue.seriesId]));
    const book = fromGcdIssue(issue, seriesById?.get(issue.seriesId), "isbn");
    // Recueil VO (TPB, omnibus) → Metron d'abord (couverture + series_type),
    // puis la chaîne ISBN (Google Books → OpenLibrary → Inventaire) pour tout
    // ce qui reste sans image — BD comprise.
    let enriched = book.suggestedCategory === "bd" ? book : await enrichWithMetron(book, deps, null, startedAtMs);
    enriched = await enrichCoverForIsbn(enriched, deps, ean13, startedAtMs);
    await cacheEnrichedGcdBook(ean13, book, enriched, deps);
    return { kind: "resolved", book: enriched };
  }

  // 3. BnF : le dépôt légal identifie la VF (manga, roman, BD absente de GCD).
  if (isBudgetExhausted(startedAtMs)) return notFoundForIsbn(deps, ean13, startedAtMs);
  const bnfRecord = await attempt(() => deps.bnf.resolveIsbn(ean13));
  if (bnfRecord) {
    let book: ResolvedBook = {
      title: bnfRecord.title,
      seriesName: bnfRecord.seriesName,
      issueNumber: bnfRecord.issueNumber,
      authors: bnfRecord.authors,
      publisher: bnfRecord.publisher,
      pageCount: bnfRecord.pageCount,
      coverUrl: null, // le SRU ne porte pas d'image — la chaîne couverture ci-dessous s'en charge
      suggestedCategory: guessCategoryFromPublisher(bnfRecord.publisher) ?? "roman",
      source: "bnf",
      sourceId: ean13,
      barcodeType: "isbn",
      barcode: raw,
      isbn: ean13,
    };
    book = await enrichCoverForIsbn(book, deps, ean13, startedAtMs);
    await attempt(() => deps.cache.set(toCacheEntry(ean13, book, "bnf")));
    return { kind: "resolved", book };
  }

  // 4. Google Books : les romans étrangers, dernier identifiant.
  if (isBudgetExhausted(startedAtMs)) return notFoundForIsbn(deps, ean13, startedAtMs);
  const googleRecord = await attempt(() => deps.googleBooks.resolveIsbn(ean13));
  if (googleRecord) {
    // La fiche sans image est le cas VF courant (mesuré §5.4) : les replis
    // OpenLibrary → Inventaire comblent avant de renoncer.
    const coverUrl = googleRecord.coverUrl ?? (await findFallbackCoverByIsbn(deps, ean13, startedAtMs));
    const book: ResolvedBook = {
      title: googleRecord.title,
      seriesName: null,
      issueNumber: null,
      authors: googleRecord.authors,
      publisher: googleRecord.publisher,
      pageCount: googleRecord.pageCount,
      coverUrl,
      suggestedCategory:
        guessCategoryFromPublisher(googleRecord.publisher) ??
        guessCategoryFromGoogleBooksCategories(googleRecord.categories) ??
        "roman",
      source: "google_books",
      sourceId: googleRecord.volumeId,
      barcodeType: "isbn",
      barcode: raw,
      isbn: ean13,
    };
    await attempt(() => deps.cache.set(toCacheEntry(ean13, book, "google_books")));
    return { kind: "resolved", book };
  }

  return notFoundForIsbn(deps, ean13, startedAtMs);
}

/** La résolution d'un UPC : GCD exact → préfixe → Metron (nouveautés). */
async function resolveUpc(raw: string, base: string, deps: ResolutionDeps, startedAtMs: number): Promise<ScanLookupResult> {
  // La clé de cache d'un UPC est le code BRUT : ici le supplément est
  // signifiant (numéro d'issue, couverture, tirage — specs §5.1).
  const cached = await attempt(() => deps.cache.get(raw));
  if (cached) return { kind: "resolved", book: fromCache(cached, "upc") };

  // 1. Match exact — GCD stocke souvent le code COMPLET (67 % avec supplément).
  const exactCodes = raw === base ? [raw] : [raw, base];
  const exactMatches = await attempt(() => deps.gcd.findIssuesByBarcode(exactCodes));
  if (exactMatches && exactMatches.length > 0) {
    const issue = exactMatches[0];
    const seriesById = await attempt(() => deps.gcd.getSeriesByIds([issue.seriesId]));
    const book = fromGcdIssue(issue, seriesById?.get(issue.seriesId), "upc");
    const enriched = await enrichWithMetron(book, deps, raw, startedAtMs);
    await cacheEnrichedGcdBook(raw, book, enriched, deps);
    return { kind: "resolved", book: enriched };
  }

  // 2. Metron par code COMPLET : quand le supplément a été scanné, un match
  //    exact identifie l'issue précisément — GCD n'a pas toujours la ligne
  //    (vécu : It's In Your Skin #1, préfixe partagé chez GCD mais code complet
  //    chez Metron). À tenter AVANT les listes par préfixe : elles sont le
  //    pis-aller des scans incomplets, pas des codes précis.
  const hasSupplement = raw !== base;
  if (hasSupplement && !isBudgetExhausted(startedAtMs)) {
    const metronExact = await attempt(() => deps.metron.findIssueByUpc(raw));
    if (metronExact) {
      const book = fromMetronIssue(metronExact, raw);
      await attempt(() => deps.cache.set(toCacheEntry(raw, book, "metron")));
      return { kind: "resolved", book };
    }
  }

  // 3. Par préfixe : les 12 premiers chiffres identifient le titre (93,9 % des
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
          issues: sortIssueCandidates(prefixMatches.filter((issue) => issue.seriesId === seriesId)),
        };
      }),
    };
  }

  // 4. Metron en dernier recours pour les scans SANS supplément (avec, il a
  //    déjà été tenté à l'étape 2) : couvre les nouveautés du dump (specs §6).
  if (!hasSupplement && !isBudgetExhausted(startedAtMs)) {
    const metronIssue = await attempt(() => deps.metron.findIssueByUpc(raw));
    if (metronIssue) {
      const book = fromMetronIssue(metronIssue, raw);
      await attempt(() => deps.cache.set(toCacheEntry(raw, book, "metron")));
      return { kind: "resolved", book };
    }
  }

  // Un UPC n'a pas de chaîne couverture par ISBN : la saisie partira sur la photo.
  return { kind: "not-found", coverUrl: null };
}

/** Construit un livre depuis une issue Metron (identification directe). */
function fromMetronIssue(metronIssue: MetronIssue, raw: string): ResolvedBook {
  return {
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
    barcode: raw,
    isbn: null,
  };
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

/** Le 4ᵉ chiffre du supplément UPC encode la couverture : 1 = la principale. */
const UPC_COVER_DIGIT_INDEX = 15;
const isMainCover = (barcode: string | null) =>
  !barcode || barcode.length <= UPC_COVER_DIGIT_INDEX || barcode[UPC_COVER_DIGIT_INDEX] === "1";

/**
 * GCD indexe chaque VARIANTE de couverture (et chaque retirage) comme une
 * ligne à part : sans déduplication, « quel numéro ? » afficherait six fois
 * le #1. Or la variante n'a aucune importance au barème — un numéro, une
 * ligne. On garde comme représentant la couverture principale (c'est aussi
 * celle que Metron référence, donc la bonne pour aller chercher la couverture).
 */
function dedupeIssuesByNumber(issues: GcdIssue[]): GcdIssue[] {
  const representativeByNumber = new Map<string, GcdIssue>();
  for (const issue of issues) {
    const current = representativeByNumber.get(issue.number);
    if (
      !current ||
      (isMainCover(issue.barcode) && !isMainCover(current.barcode)) ||
      (isMainCover(issue.barcode) === isMainCover(current.barcode) && issue.gcdId < current.gcdId)
    ) {
      representativeByNumber.set(issue.number, issue);
    }
  }
  return [...representativeByNumber.values()];
}

const sortIssueCandidates = (issues: GcdIssue[]) =>
  dedupeIssuesByNumber(issues)
    .map((issue) => ({ gcdId: issue.gcdId, number: issue.number, title: issue.title || null }))
    .sort((left, right) => {
      const leftNumber = Number(left.number);
      const rightNumber = Number(right.number);
      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
      return left.number.localeCompare(right.number);
    });

/** Le point d'entrée : un code scanné, un résultat — jamais d'exception. */
export async function resolveScannedCode(input: string, deps: ResolutionDeps = createDefaultDeps()): Promise<ScanLookupResult> {
  const startedAtMs = Date.now(); // le budget global court dès l'entrée dans la cascade
  const code = classifyScannedCode(input);
  if (code.type === "invalid") return { kind: "invalid" };
  if (code.type === "isbn") return resolveIsbn(code.raw, code.ean13, code.isbnCandidates, deps, startedAtMs);
  return resolveUpc(code.raw, code.base, deps, startedAtMs);
}

/**
 * Re-déroule la SEULE chaîne couverture pour un livre déjà identifié — le
 * cœur de la réparation des liens cassés (issue #53) : un ISBN repasse par
 * Google Books puis les replis (§5.4), un UPC par Metron. Rend la première
 * URL trouvée, ou null — jamais d'exception (mêmes amortisseurs que la
 * cascade).
 */
export async function findReplacementCover(
  book: { barcodeType: "isbn" | "upc"; isbn: string | null; barcode: string | null },
  deps: ResolutionDeps = createDefaultDeps(),
): Promise<string | null> {
  const startedAtMs = Date.now();
  if (book.barcodeType === "isbn" && book.isbn) {
    const record = await attempt(() => deps.googleBooks.resolveIsbn(book.isbn as string));
    return record?.coverUrl ?? (await findFallbackCoverByIsbn(deps, book.isbn, startedAtMs));
  }
  if (book.barcodeType === "upc" && book.barcode) {
    const metronIssue = await attempt(() => deps.metron.findIssueByUpc(book.barcode as string));
    return metronIssue?.coverUrl ?? null;
  }
  return null;
}

/** Résout une issue GCD précise — après un choix dans une liste (pick). */
export async function resolveGcdIssue(gcdId: number, deps: ResolutionDeps = createDefaultDeps()): Promise<ScanLookupResult> {
  const startedAtMs = Date.now();
  const issue = await attempt(() => deps.gcd.getIssueByGcdId(gcdId));
  if (!issue) return { kind: "not-found", coverUrl: null };
  const seriesById = await attempt(() => deps.gcd.getSeriesByIds([issue.seriesId]));
  const barcodeType = issue.barcode ? "upc" : "isbn";
  const book = fromGcdIssue(issue, seriesById?.get(issue.seriesId), barcodeType);
  const enriched = await enrichWithMetron(book, deps, issue.barcode, startedAtMs);
  // Parcours « pick » : le code scanné était un préfixe (la série entière), il
  // ne peut pas servir de clé — on cache sous le code COMPLET que GCD connaît
  // pour CETTE issue (un UPC : clé brute, supplément signifiant).
  //
  // LIMITE ASSUMÉE (review #23) : on n'arrive ici que parce que le code scanné
  // n'a PAS matché en exact chez GCD — `issue.barcode` en diffère donc par
  // construction, et re-scanner le même exemplaire repassera par préfixe+pick
  // sans relire cette entrée. Le §8 (« jamais résolu deux fois ») n'est pas
  // tenu pour ce parcours : l'entrée ne sert qu'à un futur scan d'un exemplaire
  // dont le code vaut exactement celui de GCD. On la garde quand même (elle est
  // gratuite et correcte) ; cacher sous le préfixe scanné serait un BUG — il
  // pointe plusieurs issues, on résoudrait à tort les autres numéros vers
  // celui-ci.
  if (issue.barcode) await cacheEnrichedGcdBook(issue.barcode, book, enriched, deps);
  return { kind: "resolved", book: enriched };
}
