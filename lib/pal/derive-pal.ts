import type { Database } from "@/lib/supabase/database.types";
import type { BookCategory, IsoDate } from "@/lib/scoring/types";

/**
 * La dérivation de la PAL — fonction PURE, sœur du moteur de score
 * (lib/scoring/monthly-report.ts) : des faits en entrée, la pile en sortie.
 * Le bilan et la PAL doivent raconter LA MÊME histoire (specs §4.5) — en cas
 * de doute, c'est la sémantique du moteur qui fait foi.
 *
 * Les règles de pile, alignées sur le moteur :
 *  - possédé = le livre a un achat actif, OU une possession déclarée « je
 *    possède » (#101). Une lecture sans possession (emprunt, médiathèque) n'est
 *    JAMAIS dans la pile (§4.5, les deux dénominateurs) ;
 *  - acquérir un livre DÉJÀ LU ne fait pas grossir la pile (§3.3, même règle
 *    que l'annulation du malus) — vrai d'un achat comme d'une déclaration ;
 *  - UNE sortie par livre : la PREMIÈRE fin de lecture d'un livre alors en
 *    pile, ou sa sortie de possession (don, revente). Une relecture re-rapporte
 *    ses points mais ne re-vide pas la pile, et une fin antérieure à toute
 *    entrée ne sort rien (décision du 14/07/2026).
 *
 * **Les dates peuvent manquer (#101), et c'est structurant.** L'étagère d'avant
 * l'app n'a ni date d'acquisition ni date de lecture connue. On ne les invente
 * pas : l'APPARTENANCE à la pile (un booléen) est dérivée sans date, et seuls
 * les mouvements DATÉS alimentent les flux du mois et la courbe. Un livre entré
 * sans date compte donc dans le STOCK, jamais dans les FLUX.
 *
 * Comme partout : dates ISO `YYYY-MM-DD`, comparaison lexicographique =
 * comparaison chronologique, jamais de `Date`.
 */

/** Ce que la vue PAL affiche pour un livre encore dans la pile. */
export type PalEntry = {
  bookId: string;
  title: string;
  seriesName: string | null;
  issueNumber: string | null;
  category: BookCategory;
  coverUrl: string | null;
  /** La date d'entrée en pile — `null` si elle est inconnue (« je possède » sans date, #101). */
  enteredAt: IsoDate | null;
  /**
   * Comment le livre est entré en pile — c'est lui qui décide du geste de
   * retrait : on n'annule pas un achat qui n'existe pas (#101).
   */
  entrySource:
    | { kind: "purchase"; purchaseId: string }
    | { kind: "ownership"; ownershipId: string };
  isInProgress: boolean;
};

/**
 * Le cœur de la règle de pile pour UN livre — partagé entre la vue PAL et le
 * garde du doublon d'achat (lib/books/pile-guard.ts), pour que les deux
 * racontent la MÊME histoire.
 */
export type PileInput = {
  /** Les dates d'achat ACTIVES (dans n'importe quel ordre — la fonction trie). */
  purchaseDates: IsoDate[];
  /**
   * La possession DÉCLARÉE active du livre, ou `null` s'il n'y en a pas. Quand
   * elle existe, elle fait autorité sur la possession (elle seule sait dire
   * « je ne le possède plus » d'un livre pourtant acheté).
   */
  ownership: { ownedSince: IsoDate | null; disposedAt: IsoDate | null } | null;
  /** Les dates de fin des lectures terminées DATÉES. */
  finishedDates: IsoDate[];
  /** Au moins une lecture terminée sans date connue (« déjà lu », #101). */
  hasUndatedFinish: boolean;
};

export type PileStatus = {
  /** Le livre est-il entré en pile un jour ? */
  entered: boolean;
  /** Sa date d'ENTRÉE — `null` avec `entered` à vrai = entré à une date inconnue. */
  entryDate: IsoDate | null;
  /** En est-il ressorti (lu, donné, revendu) ? */
  exited: boolean;
  /** Sa date de SORTIE — `null` avec `exited` à vrai = sorti à une date inconnue. */
  exitDate: IsoDate | null;
};

/** Jamais entré : emprunt, ou acquisition d'un livre déjà lu (§3.3). */
const NEVER_IN_PILE: PileStatus = { entered: false, entryDate: null, exited: false, exitDate: null };

/** Dans la pile MAINTENANT : entré et pas encore ressorti. */
export const isInPileNow = (status: PileStatus): boolean => status.entered && !status.exited;

export function derivePileStatus({
  purchaseDates,
  ownership,
  finishedDates,
  hasUndatedFinish,
}: PileInput): PileStatus {
  const finished = [...finishedDates].sort();
  const hasAnyFinish = finished.length > 0 || hasUndatedFinish;

  // ACQUISITIONS : les achats actifs et la possession déclarée. Une déclaration
  // sans `ownedSince` est une acquisition à date INCONNUE (l'étagère d'avant).
  const datedAcquisitions = [...purchaseDates];
  if (ownership?.ownedSince != null) datedAcquisitions.push(ownership.ownedSince);
  datedAcquisitions.sort();
  const hasUndatedAcquisition = ownership !== null && ownership.ownedSince === null;

  // Rien qui fasse posséder le livre : une lecture d'emprunt n'entre pas en pile.
  if (datedAcquisitions.length === 0 && !hasUndatedAcquisition) return NEVER_IN_PILE;

  // ENTRÉE : la première acquisition qui n'était pas déjà lue (§3.3) — racheter
  // (ou déclarer) un livre déjà terminé ne fait pas grossir la pile.
  const entryDate = datedAcquisitions.find((acquiredAt) => !finished.some((end) => end <= acquiredAt)) ?? null;

  if (entryDate === null) {
    // Aucune acquisition datable ne fait entrer le livre. Une acquisition SANS
    // date ne le fait entrer que si le livre n'a JAMAIS été terminé : sinon on
    // ne saurait ni la placer, ni dire qu'elle a précédé la lecture — et « je
    // possède un livre que j'ai déjà lu » n'est pas une entrée en pile (§3.3).
    if (!hasUndatedAcquisition || hasAnyFinish) return NEVER_IN_PILE;
    // Entré, date inconnue. Sa seule sortie possible est une fin de possession
    // (il n'a aucune lecture terminée, cf. la garde ci-dessus).
    const disposedAt = ownership?.disposedAt ?? null;
    return { entered: true, entryDate: null, exited: disposedAt !== null, exitDate: disposedAt };
  }

  // SORTIE : le premier événement qui vide le livre de la pile — une fin de
  // lecture survenue alors qu'il y était, ou une sortie de possession. (Une fin
  // antérieure à l'entrée aurait empêché cette entrée d'exister.)
  const datedFinishExit = finished.find((end) => end >= entryDate) ?? null;

  // Une fin sans date sort le livre de la pile sans qu'on puisse la dater. Elle
  // prime sur la sortie de possession : on lit un livre avant de s'en séparer,
  // et dater cette sortie au don placerait le mouvement dans le mauvais mois.
  if (datedFinishExit === null && hasUndatedFinish) {
    return { entered: true, entryDate, exited: true, exitDate: null };
  }

  const disposedAt = ownership?.disposedAt ?? null;
  const datedExits = [datedFinishExit, disposedAt].filter((date): date is IsoDate => date !== null).sort();
  const exitDate = datedExits[0] ?? null;
  return { entered: true, entryDate, exited: exitDate !== null, exitDate };
}

/**
 * Les faits MINIMAUX que le réducteur partagé consomme — en camelCase, la
 * forme des moteurs (lib/stats). Les Rows snake_case de la base passent par
 * un adaptateur fin (cf. derivePal ci-dessous). Génériques : chaque appelant
 * garde ses champs propres (id d'achat, note de lecture…) à travers le filtre.
 */
export type PurchaseFact = { purchasedAt: string; deletedAt: string | null };
export type ReadingFact = { status: string; finishedAt: string | null; deletedAt: string | null };
export type OwnershipFact = { ownedSince: string | null; disposedAt: string | null; deletedAt: string | null };

/**
 * Les achats ACTIFS (non annulés par « je ne l'ai pas acheté »), triés du plus
 * ancien au plus récent — LE filtre de possession par achat, écrit une seule
 * fois (#78).
 */
export function activePurchasesOf<P extends PurchaseFact>(purchases: P[]): P[] {
  return purchases
    .filter((purchase) => purchase.deletedAt === null)
    .sort((left, right) => left.purchasedAt.localeCompare(right.purchasedAt));
}

/**
 * La possession DÉCLARÉE active du livre (#101), ou `null`. La base garantit
 * qu'il n'y en a qu'une (index unique partiel `ownerships_active_book_idx`) ;
 * on prend la première non supprimée sans rien supposer de plus.
 */
export function activeOwnershipOf<O extends OwnershipFact>(ownerships: O[]): O | null {
  return ownerships.find((ownership) => ownership.deletedAt === null) ?? null;
}

/**
 * Les lectures TERMINÉES actives — les seules qui comptent comme FINS pour la
 * pile (§4.5/§4.6 : l'abandon n'est pas une fin, une lecture supprimée non
 * plus). LE filtre de fin, écrit une seule fois (#78). Attention : depuis #101
 * une lecture terminée peut n'avoir AUCUNE date (« déjà lu »), d'où le second
 * filtre ci-dessous — ne pas supposer ici que `finishedAt` est renseignée.
 */
export function finishedReadingsOf<R extends ReadingFact>(readings: R[]): R[] {
  return readings.filter((reading) => reading.deletedAt === null && reading.status === "finished");
}

/** Les fins DATÉES — celles qui peuvent alimenter un mois (flux, courbe, points). */
export function finishedDatesOf<R extends ReadingFact>(readings: R[]): IsoDate[] {
  return finishedReadingsOf(readings)
    .map((reading) => reading.finishedAt)
    .filter((finishedAt): finishedAt is IsoDate => finishedAt !== null);
}

/**
 * Les lectures EN COURS actives — celles qui font dire « je suis dedans » à la
 * vue PAL, et « ça traîne » aux stats (#30 lot A) quand elles durent. Même
 * esprit que les filtres ci-dessus : écrit une seule fois, jamais recopié.
 */
export function inProgressReadingsOf<R extends ReadingFact>(readings: R[]): R[] {
  return readings.filter((reading) => reading.deletedAt === null && reading.status === "reading");
}

/**
 * Le mouvement de pile d'UN livre entré : son entrée, sa sortie éventuelle, et
 * ce qui l'a fait entrer.
 */
export type BookMovement<P extends PurchaseFact, O extends OwnershipFact> = {
  /** La date d'ENTRÉE en pile — `null` si elle est inconnue (#101). */
  entryDate: IsoDate | null;
  /** Est-il ressorti de la pile ? */
  exited: boolean;
  /** Sa date de SORTIE — `null` s'il est encore en pile, ou sorti sans date connue. */
  exitDate: IsoDate | null;
  /**
   * Ce qui a fait entrer le livre : l'achat qu'annule « je ne l'ai pas acheté »,
   * ou la possession déclarée que retire « je ne le possède plus ». La vue PAL
   * en déduit le bon geste — jamais annuler un achat inexistant (#101).
   */
  entryVia: { kind: "purchase"; purchase: P } | { kind: "ownership"; ownership: O };
};

/**
 * Le réducteur PARTAGÉ faits → mouvement (issue #78) : filtrer les achats
 * actifs, la possession déclarée et les fins de lecture, puis dériver le statut
 * de pile. `derivePal` (vue PAL), `computeStats` (stats) et le garde du doublon
 * passent TOUS par ici — un futur critère de filtrage ne s'ajoute qu'à un
 * endroit. Rend `null` si le livre n'est jamais entré en pile (ni achat ni
 * possession, ou acquisition d'un déjà-lu §3.3).
 */
export function bookToMovement<
  P extends PurchaseFact,
  R extends ReadingFact,
  O extends OwnershipFact,
>(book: {
  purchases: P[];
  readings: R[];
  ownerships?: O[] | null;
}): BookMovement<P, O> | null {
  const activePurchases = activePurchasesOf(book.purchases);
  const ownership = activeOwnershipOf(book.ownerships ?? []);
  const finishedReadings = finishedReadingsOf(book.readings);
  const finishedDates = finishedDatesOf(book.readings);

  // La règle de pile vit dans le cœur partagé (derivePileStatus).
  const status = derivePileStatus({
    purchaseDates: activePurchases.map((purchase) => purchase.purchasedAt as IsoDate),
    ownership:
      ownership === null
        ? null
        : {
            ownedSince: ownership.ownedSince as IsoDate | null,
            disposedAt: ownership.disposedAt as IsoDate | null,
          },
    finishedDates,
    hasUndatedFinish: finishedReadings.length > finishedDates.length,
  });
  if (!status.entered) return null;

  // Ce qui a fait entrer le livre. Un achat à la date d'entrée l'emporte : c'est
  // le geste le plus précis (et le seul annulable en un tap). Sinon, c'est la
  // possession déclarée — y compris quand l'entrée n'a pas de date.
  const entryPurchase = activePurchases.find((purchase) => purchase.purchasedAt === status.entryDate) ?? null;
  const entryVia: BookMovement<P, O>["entryVia"] =
    entryPurchase !== null
      ? { kind: "purchase", purchase: entryPurchase }
      : // Entré sans achat → la possession existe forcément (sinon derivePileStatus
        // n'aurait pas fait entrer le livre).
        { kind: "ownership", ownership: ownership! };

  return { entryDate: status.entryDate, exited: status.exited, exitDate: status.exitDate, entryVia };
}

type Tables = Database["public"]["Tables"];

/**
 * Un livre tel que la page le charge — achats, lectures et possession embarqués.
 * Dérivé des Rows générés : la forme reste explicite (fonction pure, entrée
 * assumée), mais chaque champ est garanti aligné sur le schéma.
 *
 * `ownerships` est OPTIONNEL : les requêtes qui ne l'embarquent pas encore
 * continuent de compiler et de dériver la pile depuis les seuls achats — le
 * comportement d'avant #101, à l'identique.
 */
export type PalBookRecord = Pick<
  Tables["books"]["Row"],
  "id" | "title" | "series_name" | "issue_number" | "category" | "cover_url" | "deleted_at"
> & {
  purchases: Pick<Tables["purchases"]["Row"], "id" | "purchased_at" | "deleted_at">[] | null;
  readings: Pick<Tables["readings"]["Row"], "status" | "finished_at" | "deleted_at">[] | null;
  ownerships?: Pick<Tables["ownerships"]["Row"], "id" | "owned_since" | "disposed_at" | "deleted_at">[] | null;
};

/** Exactement ce que `PalView` consomme. */
export type PalDerivation = {
  /** Les livres encore dans la pile, du plus ancien connu au plus récent. */
  entries: PalEntry[];
  /** Les dates d'ENTRÉE de pile connues (une par livre entré à une date connue). */
  entryDates: IsoDate[];
  /** Les dates de SORTIE de pile connues (une par livre sorti à une date connue). */
  exitDates: IsoDate[];
  /** Les livres entrés à une date INCONNUE — du stock, jamais du flux (#101). */
  undatedEntryCount: number;
  /** Les livres sortis à une date INCONNUE — du stock, jamais du flux (#101). */
  undatedExitCount: number;
};

export function derivePal(books: PalBookRecord[]): PalDerivation {
  const entries: PalEntry[] = [];
  const entryDates: IsoDate[] = [];
  const exitDates: IsoDate[] = [];
  let undatedEntryCount = 0;
  let undatedExitCount = 0;

  for (const book of books) {
    // Suppression douce : un livre retiré n'existe plus pour la pile.
    if (book.deleted_at !== null) continue;

    // Le réducteur partagé (#78), via un adaptateur fin snake_case → camelCase :
    // les Rows de la base parlent snake_case, le réducteur parle la langue des
    // moteurs. Les identifiants traversent le filtre (générique) : ce sont eux
    // qui portent le geste de retrait depuis la vue PAL.
    const movement = bookToMovement({
      purchases: (book.purchases ?? []).map((purchase) => ({
        id: purchase.id,
        purchasedAt: purchase.purchased_at,
        deletedAt: purchase.deleted_at,
      })),
      readings: (book.readings ?? []).map((reading) => ({
        status: reading.status,
        finishedAt: reading.finished_at,
        deletedAt: reading.deleted_at,
      })),
      ownerships: (book.ownerships ?? []).map((ownership) => ({
        id: ownership.id,
        ownedSince: ownership.owned_since,
        disposedAt: ownership.disposed_at,
        deletedAt: ownership.deleted_at,
      })),
    });
    if (movement === null) continue; // jamais entré : emprunt ou acquisition d'un déjà-lu

    // UNE entrée par livre : la pile compte des LIVRES à lire, pas des
    // exemplaires — deux achats du même livre ne la font grossir qu'une fois,
    // exactement comme une seule lecture annule leurs deux malus au bilan
    // (§3.3). Le solde du mois reste ainsi cohérent avec la pile affichée.
    if (movement.entryDate !== null) entryDates.push(movement.entryDate);
    else undatedEntryCount += 1;

    if (movement.exited) {
      if (movement.exitDate !== null) exitDates.push(movement.exitDate);
      else undatedExitCount += 1;
      continue; // sorti de la pile — l'achat, lui, reste dans l'historique
    }

    entries.push({
      bookId: book.id,
      title: book.title,
      seriesName: book.series_name,
      issueNumber: book.issue_number,
      category: book.category,
      coverUrl: book.cover_url,
      enteredAt: movement.entryDate,
      entrySource:
        movement.entryVia.kind === "purchase"
          ? { kind: "purchase", purchaseId: movement.entryVia.purchase.id }
          : { kind: "ownership", ownershipId: movement.entryVia.ownership.id },
      isInProgress:
        inProgressReadingsOf(
          (book.readings ?? []).map((reading) => ({
            status: reading.status,
            finishedAt: reading.finished_at,
            deletedAt: reading.deleted_at,
          })),
        ).length > 0,
    });
  }

  // Les entrées sans date connue d'abord (l'étagère d'avant, par définition
  // antérieure), puis les autres du plus ancien au plus récent.
  entries.sort((left, right) => {
    if (left.enteredAt === null) return right.enteredAt === null ? 0 : -1;
    if (right.enteredAt === null) return 1;
    return left.enteredAt.localeCompare(right.enteredAt);
  });

  return { entries, entryDates, exitDates, undatedEntryCount, undatedExitCount };
}
