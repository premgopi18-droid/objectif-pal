import { addMonths } from "@/lib/dates";
import type { Month } from "@/lib/scoring/types";

/**
 * Comble les mois sans mouvement de la courbe cumulée (`computeStats` ne
 * produit que les mois à mouvement) : chaque mois manquant reprend la taille
 * du mois précédent, à plat. Sans ça, l'axe du temps mentirait — deux mois
 * espacés d'un an sembleraient consécutifs (le skill dataviz appelle ça un
 * axe temporel malhonnête).
 */
export function fillMonthGaps(points: { month: Month; size: number }[]): { month: Month; size: number }[] {
  if (points.length <= 1) return points;

  const filled: { month: Month; size: number }[] = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];
    // Les mois intermédiaires portent la taille du mois précédent.
    for (let month = addMonths(previous.month, 1); month < next.month; month = addMonths(month, 1)) {
      filled.push({ month, size: previous.size });
    }
    filled.push(next);
  }
  return filled;
}
