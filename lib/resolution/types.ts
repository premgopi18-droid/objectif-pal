import type { BookCategory } from "@/lib/scoring/types";

/**
 * Les formes que peut prendre la résolution d'un scan — specs §5.3 :
 * dégradation douce, jamais d'échec sec. Chaque `kind` correspond à un
 * geste UI différent (zéro question / un tap / deux taps / saisie manuelle).
 */

export type MetadataSource = "gcd" | "bnf" | "google_books" | "metron" | "manual";

/**
 * Timeout d'UN appel provider (BnF, Google Books, Metron) — partagé, jamais
 * recopié. 4 s suffisent largement : le cas normal mesuré est 300-800 ms
 * (specs §8) ; au-delà, la source est considérée en rade et la cascade
 * descend d'un cran plutôt que de laisser l'utilisateur devant
 * « Résolution en cours… ».
 */
export const PROVIDER_REQUEST_TIMEOUT_MILLISECONDS = 4000;

/** Un livre résolu, normalisé quelle que soit la source. */
export type ResolvedBook = {
  title: string | null;
  seriesName: string | null;
  issueNumber: string | null;
  authors: string | null;
  publisher: string | null;
  pageCount: number | null;
  coverUrl: string | null;
  /** Proposée, JAMAIS imposée — corrigeable en un tap (specs §5.5). */
  suggestedCategory: BookCategory;
  source: MetadataSource;
  /** L'identifiant chez la source (dont le gcd_id) — permet de re-résoudre. */
  sourceId: string | null;
  barcodeType: "isbn" | "upc";
  /**
   * Le code-barres connu pour ce livre. Sur un scan direct, l'UI préférera le
   * code réellement scanné ; sur un parcours pick (préfixe partagé), c'est LUI
   * qui doit entrer dans `books.barcode_raw` — jamais le préfixe, qui
   * identifierait la série entière et dédoublonnerait à tort.
   */
  barcode: string | null;
  isbn: string | null;
};

/** Une issue candidate quand la série est connue mais pas le numéro. */
export type IssueCandidate = {
  gcdId: number;
  number: string;
  title: string | null;
};

/** Une série candidate quand le préfixe est partagé (18,3 % des cas). */
export type SeriesCandidate = {
  seriesId: number;
  seriesName: string;
  publisher: string | null;
  /** Ses issues sous ce préfixe : le second tap se fait sans nouvel appel. */
  issues: IssueCandidate[];
};

export type ScanLookupResult =
  /** Code complet ou source directe : zéro question. */
  | { kind: "resolved"; book: ResolvedBook }
  /** Préfixe net → série connue : « quel numéro ? », un tap. */
  | { kind: "pick-issue"; seriesId: number; seriesName: string; publisher: string | null; issues: IssueCandidate[] }
  /** Préfixe partagé → liste courte de séries : deux taps. */
  | { kind: "pick-series"; candidates: SeriesCandidate[] }
  /** Rien trouvé nulle part → l'UI enchaîne sur la saisie manuelle. */
  | { kind: "not-found" }
  /** Pas un code exploitable (trop court, illisible). */
  | { kind: "invalid" };

/**
 * Une entrée du cache de résolutions (`barcode_cache`). Y entrent les
 * résolutions externes (BnF, Google Books, Metron) ET les résolutions GCD
 * une fois ENRICHIES (couverture Metron / Google Books) : la ligne GCD est
 * déjà en base, mais son enrichissement coûte 2-3 appels réseau — c'est lui
 * qu'on ne veut jamais repayer (specs §8).
 */
export type CacheEntry = {
  barcode: string;
  title: string | null;
  seriesName: string | null;
  issueNumber: string | null;
  authors: string | null;
  publisher: string | null;
  pageCount: number | null;
  coverUrl: string | null;
  source: Exclude<MetadataSource, "manual">;
  sourceId: string | null;
};
