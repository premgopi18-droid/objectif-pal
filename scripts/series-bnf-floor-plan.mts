/**
 * Le plan et le verdict du job « plancher VF » (#299) — purs, testés, partagés
 * par scripts/series-bnf-floor.mts.
 *
 *  - la SÉLECTION : les séries à identifiant BnF, jamais relues d'abord, puis
 *    les plus anciennes, bornées par run — le parc se rattrape en quelques
 *    nuits, puis se rafraîchit de fait chaque semaine ;
 *  - l'AUTEUR de la requête : le nom de famille du premier auteur d'un livre
 *    relié (« Eiichirō Oda, Djamel Rabahi » → « Oda ») — l'index BnF `bib.author`
 *    matche sur les noms ; sans auteur, le titre seul (plus de pages, même
 *    exactitude au regroupement) ;
 *  - le VERDICT : une panne réseau généralisée ou une erreur de notre côté
 *    rend le run rouge ; un plancher introuvable n'est pas une erreur.
 */

export const FLOOR_RUN_LIMIT = 150;
export const FLOOR_MAX_PAGES = 5;
/** Mesuré ~7 s par page pour One Piece : 30 s ne coûte que sur panne (review #300). */
export const FLOOR_PAGE_TIMEOUT_MS = 30_000;
export const FLOOR_POLITENESS_DELAY_MS = 250;
/**
 * Le budget d'un run (review #300) : une BnF lente une nuit ne doit pas
 * faire tuer le job par Actions sans bilan — on s'arrête proprement, les
 * séries non relues repassent demain (elles sont déjà en tête de file).
 */
export const FLOOR_RUN_BUDGET_MS = 40 * 60 * 1000;

/** La plus ancienne relecture d'une série : `null` dès qu'une édition n'a jamais été relue, sinon la plus ancienne date. */
export function oldestCheckedAt(dates: readonly (string | null)[]): string | null {
  if (dates.length === 0 || dates.some((date) => date === null)) return null;
  return [...(dates as string[])].sort()[0];
}

export type FloorTarget = {
  seriesId: string;
  name: string;
  /** Le nom d'auteur pour la requête, ou `null`. */
  author: string | null;
  bnfSeriesIds: string[];
  /** La plus ancienne relecture parmi ses éditions ; `null` = jamais relue. */
  oldestCheckedAt: string | null;
};

/** Jamais relues d'abord, puis les plus anciennes, puis le nom — bornées. */
export function selectFloorTargets(targets: readonly FloorTarget[], limit = FLOOR_RUN_LIMIT): FloorTarget[] {
  return [...targets]
    .sort(
      (left, right) =>
        Number(left.oldestCheckedAt !== null) - Number(right.oldestCheckedAt !== null) ||
        (left.oldestCheckedAt ?? "").localeCompare(right.oldestCheckedAt ?? "") ||
        left.name.localeCompare(right.name, "fr"),
    )
    .slice(0, limit);
}

/** « Eiichirō Oda, Djamel Rabahi » → « Oda » ; « scénario, Alex Chauvel » → « Chauvel » ; vide → `null`. */
const AUTHOR_ROLE_PATTERN = /^(scénario|dessin|dessins|texte|textes|illustrations?|couleurs?|adaptation|traduction)$/i;

export function authorSearchName(authors: string | null): string | null {
  if (!authors) return null;
  // Les segments (« scénario, Alex Chauvel ; dessin, Ludovic Rio ») : le premier
  // qui n'est pas un rôle est l'auteur ; son dernier mot est le nom.
  const segments = authors
    .split(/\s*(?:,|;| et | & )\s*/)
    .map((segment) => segment.replace(/\([^)]*\)/g, "").replace(/\.\s*$/, "").trim())
    .filter(Boolean);
  const first = segments.find((segment) => !AUTHOR_ROLE_PATTERN.test(segment)) ?? "";
  const last = first.split(/\s+/).filter(Boolean).at(-1) ?? "";
  // Un mot d'une lettre n'est pas un nom.
  return last.length >= 2 ? last : null;
}

export type FloorRunCounts = { processed: number; updated: number; missing: number; networkErrors: number; infraErrors: number };

/** Rouge si notre côté a cassé, ou si TOUT le réseau a échoué ; un plancher introuvable n'est pas un échec. */
export function floorRunExitCode(counts: FloorRunCounts): 0 | 1 {
  if (counts.infraErrors > 0) return 1;
  if (counts.processed > 0 && counts.networkErrors === counts.processed) return 1;
  return 0;
}
