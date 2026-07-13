import type { BookCategory } from "./types";

/**
 * LE barème — specs §3. La constante unique du jeu : jamais recopiée en dur
 * ailleurs. Le jour où le barème change, on change ce fichier et rien d'autre
 * (le score étant toujours dérivé, des années de lectures restent intactes).
 *
 * Le « meilleur paliste du mois » (+5) est parqué : il arrivera avec le mode
 * multi (P2) et vivra ici le moment venu.
 */
export const SCORING_SCALE = {
  /** Points d'une lecture TERMINÉE, par catégorie. Les demi-points existent. */
  pointsByCategory: {
    issue: 0.5,
    manga: 1,
    bd: 2,
    comics: 3,
    omnibus: 5,
    roman: 5,
  } satisfies Record<BookCategory, number>,

  /** Livre acheté et pas lu : −1, effaçable s'il est terminé dans le même mois. */
  unreadPurchasePenalty: -1,

  /** Objectif du mois atteint (toutes les cibles, all-or-nothing) : +3. */
  objectiveBonus: 3,
} as const;
