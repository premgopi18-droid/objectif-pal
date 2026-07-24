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

/**
 * La convention GCD pour un fascicule SANS numéro (one-shots, recueils) —
 * 65 145 lignes du dump la portent (mesuré le 19/07/2026, issue #58). Elle ne
 * doit jamais s'afficher : la résolution la traduit en absence, l'affichage
 * la traite en défense pour les données déjà stockées. Vit ici (et pas dans
 * le provider GCD) parce que les helpers d'affichage client-safe en ont
 * besoin — le provider tire le client Supabase serveur.
 */
export const GCD_UNNUMBERED_ISSUE_NUMBER = "[nn]";

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
  /**
   * Déjà dans la bibliothèque de l'utilisateur (issue #10) : zéro appel
   * externe. `hasFinishedReading` permet de poser « tu le relis ? » AVANT de
   * créer la lecture (specs §4.2, #35).
   */
  | { kind: "in-library"; book: ResolvedBook; hasFinishedReading: boolean; isOwned: boolean }
  /** Préfixe net → série connue : « quel numéro ? », un tap. */
  | { kind: "pick-issue"; seriesId: number; seriesName: string; publisher: string | null; issues: IssueCandidate[] }
  /** Préfixe partagé → liste courte de séries : deux taps. */
  | { kind: "pick-series"; candidates: SeriesCandidate[] }
  /**
   * Rien trouvé nulle part → l'UI enchaîne sur la saisie manuelle. La chaîne
   * couverture a quand même été tentée pour un ISBN (issue #55 — les libraires
   * distribuent des livres qu'aucune base bibliographique ne connaît) :
   * `coverUrl` pré-remplit la saisie, l'utilisateur fournit le reste.
   */
  | { kind: "not-found"; coverUrl: string | null }
  /** Pas un code exploitable (trop court, illisible). */
  | { kind: "invalid" };

/**
 * Une entrée du cache de résolutions (`barcode_cache`). Y entrent les
 * résolutions externes (BnF, Google Books, Metron), les résolutions GCD
 * une fois ENRICHIES (couverture Metron / Google Books) — la ligne GCD est
 * déjà en base, mais son enrichissement coûte 2-3 appels réseau, c'est lui
 * qu'on ne veut jamais repayer (specs §8) — ET, depuis l'issue #55, les
 * SAISIES MANUELLES rattachées à un code-barres (`source: "manual"`) : le
 * premier qui saisit un livre inconnu des bases le saisit pour tous les
 * rescans à venir.
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
  source: MetadataSource;
  sourceId: string | null;
};

/**
 * Un nombre de pages de SOURCE → un entier exploitable, ou `null` (inconnu).
 *
 * Le monde réel envoie des zéros (#154, vu en prod : BnF « 0 p. » au dépôt
 * légal, Google Books) — et 0 n'est pas un nombre de pages, c'est « on ne sait
 * pas ». Sans ce filtre, le zéro se FIGE dans barcode_cache puis bloque tous
 * les gestes (validateBook le refuse, à raison — mais l'utilisateur n'a aucun
 * champ à corriger sur la feuille de scan). Appliqué aux mappings de sources
 * ET à la lecture du cache : les entrées déjà polluées guérissent d'elles-
 * mêmes, sans migration.
 */
export const sanitizePageCount = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
