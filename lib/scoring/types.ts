/**
 * Les FAITS que le moteur de scoring consomme — specs §3 et §7.
 *
 * Le moteur est pur : il reçoit des faits déjà chargés (et déjà filtrés sur
 * `deleted_at is null` par la couche d'accès), il rend un bilan. Aucun accès
 * base, aucune horloge : tout est déterministe et testable.
 *
 * Toutes les dates sont des chaînes ISO `YYYY-MM-DD` (le type `date` de la
 * base, sans fuseau — specs §7) et un mois est `YYYY-MM`. La comparaison
 * lexicographique de ces chaînes EST la comparaison chronologique : le moteur
 * n'utilise jamais `Date`, ce qui supprime la classe entière des bugs de
 * fuseau (le piège du « 31 juillet à 23 h qui bascule en août »).
 */

/** Les six catégories du barème — miroir de l'enum `book_category` en base. */
export type BookCategory = "issue" | "manga" | "bd" | "comics" | "omnibus" | "roman";

/** Les six catégories dans l'ordre d'affichage — LA source unique, jamais redéfinie ailleurs. */
export const ALL_CATEGORIES: readonly BookCategory[] = ["issue", "manga", "bd", "comics", "omnibus", "roman"];

/** Miroir de l'enum `reading_status` en base. */
export type ReadingStatus = "reading" | "finished" | "abandoned";

/** Un mois calendaire, `YYYY-MM`. */
export type Month = string;

/** Une date du journal, `YYYY-MM-DD`. */
export type IsoDate = string;

/** Une lecture, telle que la base la connaît (jointe à la catégorie du livre). */
export type ReadingFact = {
  bookId: string;
  category: BookCategory;
  status: ReadingStatus;
  /**
   * Nullable depuis #101 : une lecture rétroactive (« je l'ai déjà lu », pour
   * l'étagère d'avant l'app) n'a pas de date de début connue — on ne l'invente
   * pas. Le score n'en dépend pas : seule `finishedAt` date les points (§3).
   */
  startedAt: IsoDate | null;
  /**
   * Renseignée uniquement quand `status` = `finished` — c'est elle qui date les
   * points. NULLE pour un « déjà lu » sans date (#101) : cette lecture est un
   * fait de bibliothèque, elle ne crédite alors aucun mois.
   */
  finishedAt: IsoDate | null;
};

/** Un achat. Le malus se joue à la date d'achat, jamais ailleurs. */
export type PurchaseFact = {
  bookId: string;
  purchasedAt: IsoDate;
};

/**
 * L'objectif d'un mois : une cible par catégorie visée (les catégories
 * absentes ne sont pas visées — jamais de cible à 0, cf. `objective_targets`).
 */
export type MonthlyObjective = Partial<Record<BookCategory, number>>;

/** La progression d'une catégorie visée, pour la jauge (P1). */
export type ObjectiveProgress = {
  category: BookCategory;
  target: number;
  finished: number;
};

/**
 * Le bilan du mois — l'écran principal, ce qu'on lit à l'antenne (specs §4.5).
 * Le score n'est qu'une ligne de ce bilan : ils ne font qu'un.
 */
export type MonthlyReport = {
  month: Month;
  /** Une ligne par catégorie : lectures TERMINÉES dans le mois. */
  finishedByCategory: Record<BookCategory, number>;
  /** Points des lectures terminées dans le mois (décimal : les demi-points existent). */
  readingPoints: number;
  /** Livres achetés dans le mois et non terminés à la clôture — la ligne du malus. */
  unreadPurchaseCount: number;
  /** Le malus correspondant (négatif ou zéro). */
  purchasePenalty: number;
  /** Absent si aucun objectif n'était déclaré pour ce mois. */
  objective: {
    progress: ObjectiveProgress[];
    achieved: boolean;
    bonus: number;
  } | null;
  /** readingPoints + purchasePenalty + bonus éventuel. */
  total: number;
};
