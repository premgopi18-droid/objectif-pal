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
  /** Une date d'ENTRÉE par livre entré à une date connue. */
  entryDates: IsoDate[];
  /** Une date de SORTIE par livre sorti à une date connue. */
  exitDates: IsoDate[];
  /**
   * Les livres entrés en pile à une date INCONNUE — « je possède » sans date
   * d'acquisition (#101). Ils comptent dans le STOCK (`pileSize`) et jamais
   * dans les FLUX du mois : scanner son étagère un samedi ne doit pas afficher
   * 80 entrées ce mois-là. Optionnel : les appelants d'avant #101 n'en ont pas.
   */
  undatedEntryCount?: number;
  /** Symétrique : les livres sortis à une date inconnue (« déjà lu », #101). */
  undatedExitCount?: number;
  /**
   * Les sorties par CESSION (don, revente — #142) : elles font maigrir le
   * STOCK, jamais le flux du mois — la tuile raconte le jeu (acheté vs lu),
   * pas la gestion d'étagère. La courbe des stats, elle, les compte (physique
   * de l'étagère) — c'est l'appelant qui choisit où il les met.
   */
  disposalExitDates?: IsoDate[];
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
 * Une entrée de pile appartient-elle au mois de référence ? (#241 — le filtre
 * de la tuile « Pile ce mois-ci ».) Une date INCONNUE n'appartient à aucun
 * mois : même règle que les flux ci-dessous, jamais de mois inventé (#101).
 */
export function isMonthEntry(enteredAt: IsoDate | null, month: Month): boolean {
  return enteredAt !== null && monthOf(enteredAt) === month;
}

/**
 * La santé de la PAL, dérivée des mouvements — fonction PURE, source unique.
 *
 * Chaque livre entré est soit ENCORE en pile, soit SORTI (jamais les deux :
 * `derivePileStatus` ne rend qu'une entrée et au plus une sortie par livre),
 * donc la taille à date est exactement « entrés − sortis ».
 */
export function computePalHealth(
  { entryDates, exitDates, undatedEntryCount = 0, undatedExitCount = 0, disposalExitDates = [] }: PalMovements,
  month: Month,
): PalHealth {
  // Les flux ne comptent QUE les mouvements datés : un mouvement sans date
  // n'appartient à aucun mois, et lui en inventer un fausserait le solde (#101).
  const monthEntries = entryDates.filter((date) => monthOf(date) === month).length;
  const monthExits = exitDates.filter((date) => monthOf(date) === month).length;
  return {
    // Le stock, lui, compte TOUT le monde : datés et non datés.
    pileSize: entryDates.length + undatedEntryCount - exitDates.length - undatedExitCount - disposalExitDates.length,
    monthEntries,
    monthExits,
    monthBalance: monthEntries - monthExits,
  };
}
