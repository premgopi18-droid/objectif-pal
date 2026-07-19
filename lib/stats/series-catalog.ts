import type { GcdProvider } from "@/lib/resolution/providers/gcd";
import { GCD_UNNUMBERED_ISSUE_NUMBER } from "@/lib/resolution/types";

/**
 * « Séries en cours & tome suivant » — #30, lot B (specs §4.5).
 *
 * C'est le SEUL morceau des analyses qui sort du modèle pur : savoir quel tome
 * vient après suppose de connaître la numérotation de la série, qui vit dans
 * notre import GCD (`gcd_issues.number` par `series_id`, specs §6). Le fichier
 * sépare donc, comme `reading-events.ts` :
 *   - `fetchSeriesCatalog` : les requêtes (bornées, indexées, jamais de N+1) ;
 *   - `deriveSeriesProgress` : la dérivation PURE et testée, appelée par
 *     `computeStats`.
 *
 * ⚠️ Ce que les données permettent VRAIMENT — mesuré le 19/07/2026 sur la base
 * de prod, pas supposé :
 *   - le lien livre → série GCD n'existe que pour les livres résolus par GCD
 *     (`metadata_source = "gcd"`, `metadata_source_id` = le `gcd_id`). Les
 *     livres BnF, Google Books, Metron ou saisis à la main ne portent qu'un
 *     `series_name` en TEXTE : aucun rattachement fiable, on ne bricole pas ;
 *   - `gcd_issues.number` est du TEXTE libre : 82,0 % de numéros purement
 *     numériques, 11,9 % de `[nn]` (fascicule sans numéro), 6,2 % d'autres
 *     formes (« 41 (842) », « 10/2020 », « 4 Pre-Order Edition »…) ;
 *   - notre import est RÉDUIT (559 516 lignes sur 2 585 543 : uniquement les
 *     issues ayant un code-barres ou un ISBN), donc le catalogue d'une série
 *     peut être troué — et un trou invisible ferait annoncer un mauvais tome.
 *     Mesure sur 356 séries françaises : **96,1 % ont une numérotation
 *     contiguë**, 19,1 % portent des numéros en double (lignes de variantes).
 *
 * D'où la règle de prudence qui gouverne tout ce fichier : **on n'annonce un
 * tome suivant que quand la numérotation est exploitable de bout en bout**
 * (contiguë, et tous les tomes lus de la série reliés à un numéro). Sinon on
 * affiche les tomes lus et on se tait — un tome suivant faux serait pire que
 * pas de tome suivant.
 */

/** Combien de séries au plus entrent dans le catalogue — borne dure de la requête. */
export const MAX_TRACKED_SERIES = 30;

/** Séries par requête de catalogue : quelques requêtes fixes, jamais une par série. */
const SERIES_PER_CATALOG_QUERY = 10;

/**
 * Le plafond de lignes d'une requête de catalogue. PostgREST tronque de toute
 * façon à 1 000 : on demande la même valeur pour DÉTECTER la troncature (autant
 * de lignes que la limite = catalogue potentiellement incomplet) et écarter ces
 * séries plutôt que de raisonner sur une numérotation amputée.
 */
const CATALOG_ROWS_PER_QUERY = 1000;

/** Un tome lu, relié à GCD — ce que le moteur extrait des livres de l'utilisateur. */
export type ReadVolumeFact = {
  /** Le `gcd_id` du tome (`books.metadata_source_id` d'une source `gcd`). */
  gcdIssueId: number;
  /** Le nom de série tel que l'app l'affiche — la clé des tomes lus par série. */
  seriesName: string | null;
};

/** Ce que GCD sait des séries commencées — la seule entrée impure du lot B. */
export type SeriesCatalog = {
  /** Les tomes lus résolus chez GCD : `gcd_id` → sa série et son numéro. */
  issues: { gcdIssueId: number; seriesId: number; number: string }[];
  /** Les séries concernées, avec TOUS les numéros connus de notre import. */
  series: { seriesId: number; seriesName: string | null; numbers: string[] }[];
};

export const EMPTY_SERIES_CATALOG: SeriesCatalog = { issues: [], series: [] };

/**
 * Pourquoi on ne dit rien du tome suivant — pour que la vue soit honnête sur
 * son silence plutôt que de laisser croire à une série finie :
 *  - `no-numbering` : aucun numéro exploitable au catalogue (que des `[nn]`,
 *    des dates, des « 41 (842) »…) ;
 *  - `holey-numbering` : les numéros connus ne se suivent pas — notre import
 *    réduit peut cacher un tome, on ne devine pas lequel manque ;
 *  - `partial-link` : tous les tomes lus de la série ne sont pas reliés à un
 *    numéro GCD (livre saisi à la main, résolu par la BnF, variante…), donc on
 *    ignore une partie de ce qui a été lu.
 */
export type SeriesProgressReason = "no-numbering" | "holey-numbering" | "partial-link";

export type SeriesProgressStatus =
  /** `nextVolume` est renseigné et fiable. */
  | "next-known"
  /** Numérotation exploitable, mais aucun tome du catalogue ne reste à lire. */
  | "no-next-known"
  /** On se tait : `reason` dit pourquoi. */
  | "unusable";

/** Une série commencée : ce qu'on en a lu, et ce qui vient après. */
export type SeriesProgress = {
  seriesId: number;
  seriesName: string;
  /** Tomes lus — le compte du moteur (livres distincts avec une lecture terminée). */
  volumesRead: number;
  /** Tomes numérotés connus de notre import GCD, doublons de variantes retirés. */
  knownVolumes: number;
  /** Le prochain tome à lire, tel que GCD le numérote. `null` hors `next-known`. */
  nextVolume: string | null;
  status: SeriesProgressStatus;
  /** Renseigné seulement quand `status === "unusable"`. */
  reason: SeriesProgressReason | null;
};

/**
 * `books.metadata_source_id` → le `gcd_id` exploitable, ou `null`. Seule une
 * source `gcd` porte un identifiant d'issue ; les autres sources numérotent
 * chez elles (volume Google, id Metron) et ne se croisent pas avec GCD.
 */
export function toGcdIssueId(source: string, sourceId: string | null): number | null {
  if (source !== "gcd" || sourceId === null) return null;
  if (!/^\d+$/.test(sourceId.trim())) return null;
  return Number(sourceId.trim());
}

/**
 * Un numéro GCD → un tome exploitable, ou `null`. Strictement numérique : tout
 * le reste (`[nn]`, « 41 (842) », « 10/2020 », « 4 Pre-Order Edition ») est du
 * texte libre dont on ne sait pas déduire un ordre.
 */
export function parseVolumeNumber(number: string | null): number | null {
  const trimmed = (number ?? "").trim();
  if (trimmed === "" || trimmed === GCD_UNNUMBERED_ISSUE_NUMBER) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

/** Les numéros distincts et triés d'un catalogue de série. */
function usableNumbers(numbers: string[]): number[] {
  const parsed = new Set<number>();
  for (const number of numbers) {
    const volume = parseVolumeNumber(number);
    if (volume !== null) parsed.add(volume);
  }
  return [...parsed].sort((left, right) => left - right);
}

/** La suite ne saute aucun tome entre son minimum et son maximum. */
function isContiguous(sorted: number[]): boolean {
  return sorted.length > 0 && sorted[sorted.length - 1] - sorted[0] + 1 === sorted.length;
}

type SeriesGroup = {
  seriesId: number;
  displayName: string | null;
  readNumbers: Set<number>;
  /** Un tome lu dont le numéro GCD n'est pas exploitable — on ne sait plus où on en est. */
  hasUnnumberedRead: boolean;
  linkedBooks: number;
};

/**
 * La dérivation PURE du lot B : les tomes lus reliés à GCD + le catalogue des
 * séries → « combien de tomes lus, quel est le suivant ». Zéro requête, zéro
 * horloge.
 *
 * `volumesReadBySeries` est le compte DÉJÀ calculé par le moteur (livres
 * distincts ayant au moins une lecture terminée, par nom de série) : on le
 * réutilise plutôt que de recompter, et son écart avec le nombre de tomes
 * reliés est précisément ce qui déclenche `partial-link`.
 */
export function deriveSeriesProgress(
  readVolumes: ReadVolumeFact[],
  catalog: SeriesCatalog,
  volumesReadBySeries: ReadonlyMap<string, number>,
): SeriesProgress[] {
  const issueById = new Map(catalog.issues.map((issue) => [issue.gcdIssueId, issue]));
  const catalogBySeriesId = new Map(catalog.series.map((entry) => [entry.seriesId, entry]));

  const groups = new Map<number, SeriesGroup>();
  for (const readVolume of readVolumes) {
    const issue = issueById.get(readVolume.gcdIssueId);
    // Tome inconnu de notre import GCD : la série n'existe pas pour nous.
    if (issue === undefined) continue;

    const group = groups.get(issue.seriesId) ?? {
      seriesId: issue.seriesId,
      displayName: null,
      readNumbers: new Set<number>(),
      hasUnnumberedRead: false,
      linkedBooks: 0,
    };
    group.linkedBooks += 1;
    // Le nom AFFICHÉ par l'app fait foi (c'est celui du journal et de la PAL) ;
    // le nom GCD ne sert que de repli.
    if (group.displayName === null && readVolume.seriesName !== null) group.displayName = readVolume.seriesName;

    const volume = parseVolumeNumber(issue.number);
    if (volume === null) group.hasUnnumberedRead = true;
    else group.readNumbers.add(volume);

    groups.set(issue.seriesId, group);
  }

  const progress: SeriesProgress[] = [];
  for (const group of groups.values()) {
    const catalogEntry = catalogBySeriesId.get(group.seriesId);
    const seriesName = group.displayName ?? catalogEntry?.seriesName ?? null;
    // Sans nom, la ligne serait illisible : on n'affiche pas une série anonyme.
    if (seriesName === null) continue;

    // Les tomes lus viennent du moteur (même règle que la répartition par
    // série) ; à défaut de nom connu de lui, le compte des livres reliés.
    const volumesRead = volumesReadBySeries.get(seriesName) ?? group.linkedBooks;
    const catalogNumbers = usableNumbers(catalogEntry?.numbers ?? []);

    progress.push({
      seriesId: group.seriesId,
      seriesName,
      volumesRead,
      knownVolumes: catalogNumbers.length,
      ...resolveNextVolume(group, catalogNumbers, volumesRead),
    });
  }

  return progress.sort(
    (left, right) => right.volumesRead - left.volumesRead || left.seriesName.localeCompare(right.seriesName),
  );
}

/** Les trois garde-fous, dans l'ordre, puis le plus petit tome non lu. */
function resolveNextVolume(
  group: SeriesGroup,
  catalogNumbers: number[],
  volumesRead: number,
): Pick<SeriesProgress, "nextVolume" | "status" | "reason"> {
  const silent = (reason: SeriesProgressReason) => ({ nextVolume: null, status: "unusable" as const, reason });

  if (catalogNumbers.length === 0) return silent("no-numbering");
  // Un trou peut être un tome que notre import réduit ne connaît pas : on ne
  // peut pas distinguer « le 2 n'existe pas » de « le 2 nous manque ».
  if (!isContiguous(catalogNumbers)) return silent("holey-numbering");
  // Il faut connaître le numéro de TOUT ce qui a été lu dans la série, sinon on
  // proposerait un tome déjà lu. Les doublons de numéro (deux livres, un même
  // tome) tombent aussi ici, et c'est voulu : le compte ne se recolle plus.
  if (group.hasUnnumberedRead || group.readNumbers.size !== volumesRead) return silent("partial-link");

  const next = catalogNumbers.find((volume) => !group.readNumbers.has(volume));
  if (next === undefined) return { nextVolume: null, status: "no-next-known", reason: null };
  return { nextVolume: String(next), status: "next-known", reason: null };
}

/**
 * Le catalogue GCD des séries commencées — la partie IMPURE, bornée par
 * construction :
 *   1. une requête `gcd_id IN (…)` pour situer les tomes lus (index `gcd_id`) ;
 *   2. une requête `id IN (…)` pour les noms de séries (clé primaire) ;
 *   3. quelques requêtes `series_id IN (…)` par paquets de
 *      `SERIES_PER_CATALOG_QUERY` séries pour la numérotation (index
 *      `gcd_issues (series_id, number)`, migration du 19/07/2026).
 *
 * Soit **au plus 2 + ⌈30 / 10⌉ = 5 requêtes**, quel que soit le nombre de tomes
 * ou de séries — jamais une requête par tome ni par série. Le nombre de séries
 * est plafonné à `MAX_TRACKED_SERIES` et chaque paquet à
 * `CATALOG_ROWS_PER_QUERY` lignes ; un paquet tronqué est ÉCARTÉ (ses séries
 * n'entrent pas au catalogue et retombent sur « pas de tome suivant »).
 */
export async function fetchSeriesCatalog(provider: GcdProvider, gcdIssueIds: number[]): Promise<SeriesCatalog> {
  const uniqueIds = [...new Set(gcdIssueIds)];
  if (uniqueIds.length === 0) return EMPTY_SERIES_CATALOG;

  // Une issue peut avoir plusieurs lignes (une par code-barres de variante,
  // cf. le commentaire de la table) : on ne garde que la première par gcd_id.
  const issuesByGcdId = new Map<number, SeriesCatalog["issues"][number]>();
  for (const issue of await provider.getIssuesByGcdIds(uniqueIds)) {
    if (issuesByGcdId.has(issue.gcdId)) continue;
    issuesByGcdId.set(issue.gcdId, { gcdIssueId: issue.gcdId, seriesId: issue.seriesId, number: issue.number });
  }
  const issues = [...issuesByGcdId.values()];

  // Tri pour que la coupe à MAX_TRACKED_SERIES soit déterministe.
  const seriesIds = [...new Set(issues.map((issue) => issue.seriesId))].sort((a, b) => a - b);
  const trackedSeriesIds = seriesIds.slice(0, MAX_TRACKED_SERIES);
  if (trackedSeriesIds.length === 0) return { issues, series: [] };

  const names = await provider.getSeriesByIds(trackedSeriesIds);

  const numbersBySeriesId = new Map<number, string[]>();
  for (let start = 0; start < trackedSeriesIds.length; start += SERIES_PER_CATALOG_QUERY) {
    const chunk = trackedSeriesIds.slice(start, start + SERIES_PER_CATALOG_QUERY);
    const rows = await provider.listSeriesVolumes(chunk, CATALOG_ROWS_PER_QUERY);
    // Autant de lignes que la limite : le catalogue de ce paquet est peut-être
    // amputé — on préfère ne rien dire de ces séries.
    if (rows.length >= CATALOG_ROWS_PER_QUERY) continue;
    for (const row of rows) {
      const numbers = numbersBySeriesId.get(row.seriesId) ?? [];
      numbers.push(row.number);
      numbersBySeriesId.set(row.seriesId, numbers);
    }
  }

  return {
    issues,
    series: [...numbersBySeriesId.entries()].map(([seriesId, numbers]) => ({
      seriesId,
      seriesName: names.get(seriesId)?.name ?? null,
      numbers,
    })),
  };
}
