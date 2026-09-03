import { computeMonthlyReport } from "@/lib/scoring/monthly-report";
import { ALL_CATEGORIES } from "@/lib/scoring/types";
import type {
  BookCategory,
  Month,
  MonthlyObjective,
  MonthlyReport,
  PurchaseFact,
  ReadingFact,
} from "@/lib/scoring/types";

/**
 * La carte d'invité (specs §4.15) : un bilan pour quelqu'un qui n'a PAS de
 * compte — les invités du live. Le formulaire ne donne que des COMPTEURS ;
 * on fabrique des faits synthétiques et on les passe au VRAI moteur
 * (`computeMonthlyReport`) : zéro barème recopié, parité garantie avec l'app
 * pour toujours — malus, bonus +3 all-or-nothing et demi-points compris.
 *
 * Dérivation pure : aucun accès base, aucune horloge. L'invité n'existe
 * jamais en base — rien n'est enregistré nulle part.
 */

export type GuestCounts = Record<BookCategory, number>;

export type GuestCardInput = {
  month: Month;
  finishedByCategory: GuestCounts;
  unreadPurchaseCount: number;
  /** Cibles facultatives — null (ou tout à 0) : l'invité n'a pas d'objectif. */
  objective: MonthlyObjective | null;
};

/**
 * Une saisie de formulaire n'est jamais fiable : entier dans [0, 999], sinon 0.
 * Le plafond borne le nombre de faits synthétiques fabriqués — une faute de
 * frappe à sept chiffres ne doit pas allouer des millions d'objets.
 */
const sanitizeCount = (value: number): number =>
  Number.isInteger(value) && value > 0 ? Math.min(value, 999) : 0;

export function buildGuestReport(input: GuestCardInput): MonthlyReport {
  // N'importe quel jour du mois convient : le moteur ne date qu'au mois près.
  const dayInMonth = `${input.month}-15`;

  const readings: ReadingFact[] = ALL_CATEGORIES.flatMap((category) =>
    Array.from(
      { length: sanitizeCount(input.finishedByCategory[category]) },
      (_, index): ReadingFact => ({
        bookId: `guest-${category}-${index}`,
        category,
        status: "finished",
        startedAt: null,
        finishedAt: dayInMonth,
      }),
    ),
  );

  // Des achats de livres jamais lus (bookId disjoints des lectures) : le malus
  // s'applique plein pot, sans annulation possible — c'est le compteur saisi.
  const purchases: PurchaseFact[] = Array.from(
    { length: sanitizeCount(input.unreadPurchaseCount) },
    (_, index): PurchaseFact => ({ bookId: `guest-purchase-${index}`, purchasedAt: dayInMonth }),
  );

  return computeMonthlyReport(input.month, { readings, purchases, objective: input.objective });
}
