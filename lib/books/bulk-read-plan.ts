import type { IsoDate } from "@/lib/scoring/types";

/**
 * Le plan du « Marquer comme lus » groupé (#256) — fonction PURE, sœur des
 * gardes de `recordPastReading` : des faits de lecture en entrée, une décision
 * par livre en sortie. Le serveur exécute, il ne décide pas — testable sans
 * base, comme le moteur de score.
 *
 * Les règles, reprises une à une des gestes unitaires :
 *  - lecture EN COURS + date commune → on la TERMINE à cette date (le sens
 *    évident du geste, décision #256) — mais jamais avant son début ;
 *  - lecture EN COURS + « date inconnue » → refus doux : on ne pose pas une
 *    fin inconnue sur une lecture active (décision du 20/07/2026) ;
 *  - doublon NON AMBIGU → refus doux, comme `recordPastReading` : une lecture
 *    terminée sans date existe déjà (mode sans date), ou terminée à la MÊME
 *    date (mode daté). Sans cette garde, un double-tap du lot compterait des
 *    relectures — des points en double au bilan (§3) ;
 *  - sinon → une lecture terminée s'insère (`started_at` NULL : une lecture
 *    rétroactive n'a pas de début connu, on n'en invente pas — la contrainte
 *    `readings_undated_finish_has_no_start` s'appuie dessus).
 */

/** La borne du lot — la pile n'est pas paginée, mais un lot n'est pas un import. */
export const MAX_BULK_BOOKS = 100;

/** Même formulation que le refus de `recordPastReading` : c'est le même refus. */
export const ALREADY_READ_MESSAGE = "Ce livre est déjà marqué comme lu.";
export const IN_PROGRESS_NEEDS_DATE_MESSAGE =
  "Une lecture est en cours — choisis une date de fin pour la terminer.";
export const FINISH_BEFORE_START_MESSAGE = "La date de fin ne peut pas précéder la date de début.";

/** Les faits de lecture d'UN livre, vus par le lot. */
export type BulkReadFacts = {
  /** La lecture en cours du livre, s'il y en a une (au plus une, garde partagée). */
  inProgress: { readingId: string; startedAt: IsoDate | null } | null;
  /** Une lecture terminée SANS date existe déjà (« déjà lu », #101). */
  hasUndatedFinish: boolean;
  /** Les dates de fin des lectures terminées datées. */
  finishedDates: IsoDate[];
};

export type BulkReadDecision =
  | { kind: "insert" }
  | { kind: "finish"; readingId: string }
  | { kind: "refuse"; error: string };

export function planBulkRead(facts: BulkReadFacts, finishedAt: IsoDate | null): BulkReadDecision {
  if (facts.inProgress !== null) {
    if (finishedAt === null) return { kind: "refuse", error: IN_PROGRESS_NEEDS_DATE_MESSAGE };
    // Fin ≥ début, comme `finishReading` (sans début connu, pas d'ordre à respecter).
    if (facts.inProgress.startedAt !== null && finishedAt < facts.inProgress.startedAt) {
      return { kind: "refuse", error: FINISH_BEFORE_START_MESSAGE };
    }
    return { kind: "finish", readingId: facts.inProgress.readingId };
  }
  const isDuplicate =
    finishedAt === null ? facts.hasUndatedFinish : facts.finishedDates.includes(finishedAt);
  if (isDuplicate) return { kind: "refuse", error: ALREADY_READ_MESSAGE };
  return { kind: "insert" };
}

/** L'échec d'UN livre du lot — le client retraduit `bookId` en titre. */
export type BulkFailure = { bookId: string; error: string };

/**
 * Le résultat d'un geste groupé : `ok: false` = rien n'est parti (validation,
 * auth) ; `ok: true` = le lot a tourné, avec ses réussites ET ses échecs —
 * « on continue et on rapporte », jamais de tout-ou-rien (décision #256).
 */
export type BulkActionResult =
  | { ok: true; succeeded: number; failures: BulkFailure[] }
  | { ok: false; error: string };

/**
 * Le texte de l'alerte d'échecs partiels — une ligne par livre, le titre
 * d'abord (l'utilisateur pense en titres, pas en ids). Un id inconnu du client
 * (fiche rafraîchie entre-temps) garde un libellé neutre plutôt que de planter.
 */
export function formatBulkFailures(
  failures: BulkFailure[],
  titleOf: (bookId: string) => string | undefined,
): string | null {
  if (failures.length === 0) return null;
  const lines = failures.map(
    (failure) => `${titleOf(failure.bookId) ?? "Un livre"} : ${failure.error}`,
  );
  const heading =
    failures.length === 1 ? "1 livre n'a pas suivi" : `${failures.length} livres n'ont pas suivi`;
  return `${heading} — ${lines.join(" · ")}`;
}
