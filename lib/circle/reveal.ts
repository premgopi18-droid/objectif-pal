import { addMonths } from "@/lib/dates";
import type { Month } from "@/lib/scoring/types";

/**
 * Le reveal du cercle (specs §4.14, issue #243) — le MIROIR TypeScript du
 * prédicat SQL `is_month_revealed`, logique PURE testée.
 *
 * « Le reveal appartient à l'émission » : un mois clos reste verrouillé pour
 * le cercle jusqu'au reveal MANUEL de son propriétaire, ou jusqu'à la bascule
 * AUTOMATIQUE au 1er du mois suivant — un prédicat de temps, aucun cron.
 * Ce miroir sert l'affichage côté propriétaire (« sera révélé automatiquement
 * le 1er septembre ») et les états du comparateur ; le SERVEUR reste le seul
 * juge de ce qui est servi aux amis.
 */

/**
 * La bascule automatique a-t-elle eu lieu ? Vrai quand un mois ENTIER s'est
 * écoulé depuis la clôture : juillet (clos le 1er août) est auto-révélé le
 * 1er septembre. Comparaison lexicographique `YYYY-MM` = chronologique.
 */
export function isAutoRevealed(month: Month, currentMonth: Month): boolean {
  return month < addMonths(currentMonth, -1);
}

/** Un mois est-il visible du cercle — révélé à la main, ou basculé par le temps ? */
export function isRevealedToCircle(month: Month, manualReveals: readonly Month[], currentMonth: Month): boolean {
  return manualReveals.includes(month) || isAutoRevealed(month, currentMonth);
}

/** Le mois de la bascule automatique — « sera révélé le 1er {ce mois-là} ». */
export function autoRevealMonth(month: Month): Month {
  return addMonths(month, 2);
}
