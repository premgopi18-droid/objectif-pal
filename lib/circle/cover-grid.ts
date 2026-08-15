/**
 * Le plafond de la grille de couvertures (#236) — logique PURE, testée.
 *
 * ~2 rangées s'affichent d'office ; au-delà, une tuile « +N » déplie le mois
 * entier. Un mois qui tient dans le plafond s'affiche entier, sans tuile —
 * le plafond ne dompte que les mois monstres.
 */

/** 2 rangées de 5 — la grille de la fiche. */
export const FINISHED_COVERS_CAP = 10;

/** Combien de tuiles montrer, et combien la tuile « +N » annonce. */
export function coverGridSlice(total: number, expanded: boolean): { visible: number; hidden: number } {
  if (expanded || total <= FINISHED_COVERS_CAP) return { visible: total, hidden: 0 };
  return { visible: FINISHED_COVERS_CAP, hidden: total - FINISHED_COVERS_CAP };
}
