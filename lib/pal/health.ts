import type { IsoDate, Month } from "@/lib/scoring/types";

/**
 * La santé de la PAL — la dérivation PARTAGÉE (issue #67, design-specs §3).
 *
 * La taille de la pile et le solde du mois étaient calculés à trois endroits
 * par trois codes différents (vue PAL, bilan, stats) : le principal doublon
 * fonctionnel du code. Cette fonction est désormais la source UNIQUE — les
 * écrans la consomment, ils ne recomptent plus.
 *
 * Le pipeline complet, en deux temps, tous deux PURS :
 *  1. par livre : `derivePileStatus` (lib/pal/derive-pal.ts) réduit les faits
 *     bruts (achats, lectures) en AU PLUS une entrée et une sortie — c'est là
 *     que vit la règle de pile (rachat d'un déjà-lu §3.3, une sortie par livre,
 *     l'abandon qui ne sort PAS de la pile car il n'est pas une fin) ;
 *  2. sur l'ensemble : cette fonction agrège ces MOUVEMENTS en santé de PAL.
 *
 * Le mois de référence arrive en ARGUMENT (le fuseau est une affaire d'UI,
 * jamais de moteur), comme au bilan et aux stats. Dates ISO `YYYY-MM-DD` :
 * comparaison lexicographique = comparaison chronologique, jamais de `Date`.
 *
 * Ce n'est PAS le malus du bilan : le malus (lib/scoring/monthly-report.ts) a
 * ses propres règles d'annulation, au grain du MOIS et par achat — à ne pas
 * confondre ni fusionner avec la santé de la PAL.
 */

/**
 * Les MOUVEMENTS de pile, tels que `derivePal` (vue PAL) et le moteur stats les
 * produisent : UNE date d'entrée par livre entré en pile, UNE date de sortie
 * par livre qui en est sorti (jamais plus, cf. `derivePileStatus`).
 */
export type PalMovements = {
  /** Une date d'ENTRÉE par livre entré (son premier achat pas-déjà-lu). */
  entryDates: IsoDate[];
  /** Une date de SORTIE par livre sorti (sa première fin survenue en pile). */
  exitDates: IsoDate[];
};

/** La santé de la PAL : taille de pile à date et solde du mois de référence. */
export type PalHealth = {
  /** Possédés non lus à date — les livres entrés jamais sortis. */
  pileSize: number;
  /** Entrées de pile du mois de référence. */
  monthEntries: number;
  /** Sorties de pile du mois de référence. */
  monthExits: number;
  /** `monthEntries − monthExits` — positif = la pile gonfle (rouge à l'écran). */
  monthBalance: number;
};

/** `2026-07-13` → `2026-07`. */
const monthOf = (date: IsoDate): Month => date.slice(0, 7);

/**
 * La santé de la PAL, dérivée des mouvements — fonction PURE, source unique.
 *
 * Chaque livre entré est soit ENCORE en pile, soit SORTI (jamais les deux :
 * `derivePileStatus` ne rend qu'une entrée et au plus une sortie par livre),
 * donc la taille à date est exactement « entrés − sortis ».
 */
export function computePalHealth({ entryDates, exitDates }: PalMovements, month: Month): PalHealth {
  const monthEntries = entryDates.filter((date) => monthOf(date) === month).length;
  const monthExits = exitDates.filter((date) => monthOf(date) === month).length;
  return {
    pileSize: entryDates.length - exitDates.length,
    monthEntries,
    monthExits,
    monthBalance: monthEntries - monthExits,
  };
}
