import type { PalEntry } from "@/lib/pal/derive-pal";
import type { BookCategory } from "@/lib/scoring/types";

/**
 * La roulette de la PAL (#262) — le tirage au sort de la prochaine lecture.
 * Module PUR : filtrage, effectifs et hasard injectable, zéro DOM — testable
 * en Vitest sans navigateur. La mise en scène (bande, décélération, confettis)
 * vit dans components/pal/reading-roulette.tsx.
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
 * Les livres qui concourent : la pile MOINS les lectures en cours — on ne
 * tire pas au sort un livre déjà commencé (décision #262). Un ensemble de
 * catégories vide signifie « toutes ». Les livres sans couverture concourent
 * comme les autres (le placeholder maison les habille).
 */
export function eligibleEntries(
  entries: readonly PalEntry[],
  selectedCategories: ReadonlySet<BookCategory>,
): PalEntry[] {
  return entries.filter(
    (entry) => !entry.isInProgress && (selectedCategories.size === 0 || selectedCategories.has(entry.category)),
  );
}

/**
 * Les effectifs par catégorie parmi les livres tirables (en-cours déjà
 * exclus) — les chips du tirage ne proposent que des catégories à effectif
 * non nul, dans l'ordre du barème (c'est un Map : l'ordre d'insertion suit
 * l'ordre de parcours des entrées, la vue ré-ordonne sur ALL_CATEGORIES).
 */
export function categoryCounts(entries: readonly PalEntry[]): Map<BookCategory, number> {
  const counts = new Map<BookCategory, number>();
  for (const entry of entries) {
    if (entry.isInProgress) continue;
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
  return sequence;
}
