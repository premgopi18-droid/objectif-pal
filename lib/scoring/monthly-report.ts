import { SCORING_SCALE } from "./scale";
import { ALL_CATEGORIES } from "./types";
import type {
  BookCategory,
  IsoDate,
  Month,
  MonthlyObjective,
  MonthlyReport,
  ObjectiveProgress,
  PurchaseFact,
  ReadingFact,
} from "./types";

/**
 * Le moteur du bilan mensuel — specs §3 (règles de calcul) et §4.5 (l'écran).
 *
 * Fonction pure : des faits en entrée, un bilan en sortie. Rejouable pour
 * n'importe quel mois passé (rien n'est jamais stocké, donc rien n'est jamais
 * périmé), ce qui est aussi la raison pour laquelle l'app n'a aucune tâche
 * planifiée de « clôture ».
 */

/** `2026-07-13` → `2026-07`. */
const monthOf = (date: IsoDate): Month => date.slice(0, 7);

/**
 * Le bilan d'un mois, dérivé des faits.
 *
 * Contrat d'appel : passer toutes les lectures TERMINÉES de l'utilisateur,
 * TOUS MOIS CONFONDUS (l'annulation du malus regarde les mois précédents —
 * la couche d'accès peut donc filtrer `status = 'finished'`, jamais par mois).
 * Les lectures en cours ou abandonnées sont acceptées mais n'influent sur rien.
 */
export function computeMonthlyReport(
  month: Month,
  facts: {
    readings: ReadingFact[];
    purchases: PurchaseFact[];
    objective?: MonthlyObjective | null;
  },
): MonthlyReport {
  const { readings, purchases, objective } = facts;

  // Règle 1 — les points sont crédités à la date de FIN. Une lecture compte
  // dans le mois où elle se termine, peu importe quand elle a commencé.
  // Règle 2 — abandonnée ou en cours : 0 point (le filtre sur `finished` suffit).
  const finishedThisMonth = readings.filter(
    (reading) => reading.status === "finished" && reading.finishedAt !== null && monthOf(reading.finishedAt) === month,
  );

  const finishedByCategory = Object.fromEntries(ALL_CATEGORIES.map((category) => [category, 0])) as Record<
    BookCategory,
    number
  >;
  for (const reading of finishedThisMonth) {
    finishedByCategory[reading.category] += 1;
  }

  const readingPoints = finishedThisMonth.reduce(
    (points, reading) => points + SCORING_SCALE.pointsByCategory[reading.category],
    0,
  );

  // Règle 3 — le malus : −1 par livre acheté ce mois-ci, effacé si le livre est
  // terminé avant la clôture du mois. Une lecture terminée un mois PRÉCÉDENT
  // efface aussi (racheter un livre déjà lu n'ajoute rien à la pile à lire) ;
  // une lecture terminée un mois SUIVANT n'efface rien : le mois est clos.
  const monthsFinishedByBook = new Map<string, Month[]>();
  for (const reading of readings) {
    if (reading.status !== "finished" || reading.finishedAt === null) continue;
    const months = monthsFinishedByBook.get(reading.bookId) ?? [];
    months.push(monthOf(reading.finishedAt));
    monthsFinishedByBook.set(reading.bookId, months);
  }

  const unreadPurchases = purchases.filter((purchase) => {
    if (monthOf(purchase.purchasedAt) !== month) return false;
    const finishedMonths = monthsFinishedByBook.get(purchase.bookId) ?? [];
    // La comparaison lexicographique de `YYYY-MM` est chronologique.
    // Assumé (review #4) : l'annulation est PAR LIVRE, pas par achat — acheter
    // deux exemplaires du même livre le même mois et en lire un annule les deux
    // malus. Cas hors du geste réel de l'app ; à reconsidérer s'il se présente.
    return !finishedMonths.some((finishedMonth) => finishedMonth <= month);
  });

  const unreadPurchaseCount = unreadPurchases.length;
  // Le ternaire évite `0 × −1 = −0` (le zéro négatif de JS, qui n'est pas `+0`
  // pour Object.is et s'afficherait mal dans un bilan).
  const purchasePenalty = unreadPurchaseCount === 0 ? 0 : unreadPurchaseCount * SCORING_SCALE.unreadPurchasePenalty;

  // Règle 4 — l'objectif : all-or-nothing, seules les lectures terminées dans
  // le mois comptent. Pas d'objectif déclaré (ou aucune cible) → pas de bonus.
  const targetedCategories = objective
    ? ALL_CATEGORIES.filter((category) => (objective[category] ?? 0) > 0)
    : [];

  let objectiveReport: MonthlyReport["objective"] = null;
  if (objective && targetedCategories.length > 0) {
    const progress: ObjectiveProgress[] = targetedCategories.map((category) => ({
      category,
      target: objective[category] as number,
      finished: finishedByCategory[category],
    }));
    const achieved = progress.every((line) => line.finished >= line.target);
    objectiveReport = {
      progress,
      achieved,
      bonus: achieved ? SCORING_SCALE.objectiveBonus : 0,
    };
  }

  // Règle 5 — le score du mois. Règle 6 — il est décimal, et comme tous les
  // points sont des multiples de 0,5, le flottant est exact : aucun arrondi.
  const total = readingPoints + purchasePenalty + (objectiveReport?.bonus ?? 0);

  return {
    month,
    finishedByCategory,
    readingPoints,
    unreadPurchaseCount,
    purchasePenalty,
    objective: objectiveReport,
    total,
  };
}
