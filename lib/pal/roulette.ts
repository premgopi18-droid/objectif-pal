import type { PalEntry } from "@/lib/pal/derive-pal";
import type { BookCategory } from "@/lib/scoring/types";

/**
 * La roulette de la PAL (#262) — le tirage au sort de la prochaine lecture.
 * Module PUR : filtrage, effectifs et hasard injectable, zéro DOM — testable
 * en Vitest sans navigateur. La mise en scène (bande, décélération, confettis)
 * vit dans components/pal/reading-roulette.tsx.
 *
 * Depuis le lot C de l'epic séries (#293, §4.16) : un mode « on continue une
 * série » restreint le vivier aux tomes SUIVANTS déjà dans la pile. La
 * roulette ne connaît pas les séries : elle reçoit un ensemble d'ids de livres
 * (dérivé par `nextInPileBookIds`), et reste pure.
 */

/** Une source d'aléa au contrat de Math.random : [0, 1). Injectable pour les tests. */
export type RandomSource = () => number;

/**
 * La bande de couvertures : l'élue est posée à l'index `REEL_WINNER_INDEX`,
 * et la bande continue un peu au-delà pour que l'arrêt ne se fasse pas sur
 * un bord vide. Les deux constantes sont partagées avec la vue (le calcul du
 * déplacement cible en dépend).
 */
export const REEL_WINNER_INDEX = 28;
export const REEL_LENGTH = REEL_WINNER_INDEX + 5;

/**
 * Le vivier de base : la pile MOINS les lectures en cours — on ne tire pas au
 * sort un livre déjà commencé (décision #262) — et, en mode « on continue une
 * série », seulement les tomes suivants possédés. `null` = tous les livres.
 */
export function baseEntries(entries: readonly PalEntry[], continueSeriesBookIds: ReadonlySet<string> | null): PalEntry[] {
  return entries.filter(
    (entry) => !entry.isInProgress && (continueSeriesBookIds === null || continueSeriesBookIds.has(entry.bookId)),
  );
}

/**
 * Les livres qui concourent : le vivier de base filtré par catégories. Un
 * ensemble de catégories vide signifie « toutes ». Les livres sans couverture
 * concourent comme les autres (le placeholder maison les habille).
 */
export function eligibleEntries(
  entries: readonly PalEntry[],
  selectedCategories: ReadonlySet<BookCategory>,
  continueSeriesBookIds: ReadonlySet<string> | null = null,
): PalEntry[] {
  return baseEntries(entries, continueSeriesBookIds).filter(
    (entry) => selectedCategories.size === 0 || selectedCategories.has(entry.category),
  );
}

/**
 * Les effectifs par catégorie parmi les livres tirables (en-cours déjà
 * exclus, mode série appliqué) — les chips du tirage ne proposent que des
 * catégories à effectif non nul, dans l'ordre du barème (c'est un Map :
 * l'ordre d'insertion suit l'ordre de parcours des entrées, la vue ré-ordonne
 * sur ALL_CATEGORIES).
 */
export function categoryCounts(
  entries: readonly PalEntry[],
  continueSeriesBookIds: ReadonlySet<string> | null = null,
): Map<BookCategory, number> {
  const counts = new Map<BookCategory, number>();
  for (const entry of baseEntries(entries, continueSeriesBookIds)) {
    counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  }
  return counts;
}

/** Le tirage lui-même — équiprobable sur le vivier. `null` sur un vivier vide. */
export function drawEntry(pool: readonly PalEntry[], rng: RandomSource = Math.random): PalEntry | null {
  if (pool.length === 0) return null;
  return pool[Math.floor(rng() * pool.length)];
}

/** Fisher-Yates sur une copie — l'aléa vient de `rng`, jamais de Math.random en douce. */
function shuffled<T>(items: readonly T[], rng: RandomSource): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

/**
 * La bande du tirage : `REEL_LENGTH` couvertures piochées en cyclant des
 * mélanges du vivier, l'élue posée à `REEL_WINNER_INDEX` — la mise en scène
 * défile jusqu'à elle. Avec un petit vivier les répétitions sont normales
 * (c'est la bande d'une machine, pas une liste).
 */
export function buildReelSequence(
  pool: readonly PalEntry[],
  winner: PalEntry,
  rng: RandomSource = Math.random,
): PalEntry[] {
  const sequence: PalEntry[] = [];
  while (sequence.length < REEL_LENGTH) {
    sequence.push(...shuffled(pool, rng));
  }
  sequence.length = REEL_LENGTH;
  sequence[REEL_WINNER_INDEX] = winner;
  // L'élue ne doit pas se voir en double AU point d'arrêt (review #268) : si le
  // mélange l'a aussi posée juste à côté, la voisine est échangée avec un autre
  // livre pris loin de l'arrêt. Un vivier monotone (un seul livre) n'a pas de
  // remplaçant — le doublon y est inévitable et assumé.
  for (const neighborIndex of [REEL_WINNER_INDEX - 1, REEL_WINNER_INDEX + 1]) {
    if (sequence[neighborIndex] !== winner) continue;
    const replacementIndex = sequence.findIndex(
      (item, index) => item !== winner && Math.abs(index - REEL_WINNER_INDEX) > 1,
    );
    if (replacementIndex === -1) break;
    [sequence[neighborIndex], sequence[replacementIndex]] = [sequence[replacementIndex], sequence[neighborIndex]];
  }
  return sequence;
}
