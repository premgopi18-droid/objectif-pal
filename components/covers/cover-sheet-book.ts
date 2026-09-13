import type { CoverState } from "@/lib/books/cover-actions";

/**
 * Ce que la feuille « Changer la couverture » sait d'un livre (#275) — le type
 * partagé par la feuille et ses hooks (audit #274 : sorti de la feuille pour
 * qu'aucun hook n'importe le composant qui l'utilise).
 */
export type CoverSheetBook = {
  bookId: string;
  title: string;
  coverUrl: string | null;
  /** Inconnu de l'écran appelant ? Passer `null` : la feuille relit la vérité en base. */
  coverChosenAt: string | null;
  /** Les auteurs, s'ils sont connus — pré-remplissent la recherche d'éditions (#277). */
  authors?: string | null;
  /** Un code exploitable par les sources ? Inconnu (`undefined`) tant que la base n'a pas répondu. */
  hasCode?: boolean;
  /** Le code exact — la clé du pool partagé (#278) ; inconnu tant que la base n'a pas répondu. */
  barcodeRaw?: string | null;
  /** La couverture-source de ma contribution vivante pour ce code (#278). */
  sharedSourceCoverUrl?: string | null;
};

/**
 * Les faits relus en base (`getCoverState`) — la vérité qui remplace ce que
 * l'appelant savait. DÉRIVÉ du type de l'action (review #288), pas recopié :
 * un champ renommé côté serveur casse ici en nommant la source.
 */
export type CoverSheetFacts = Omit<Extract<CoverState, { ok: true }>, "ok">;

export const coverSheetBookFromFacts = (bookId: string, facts: CoverSheetFacts): CoverSheetBook => ({
  bookId,
  title: facts.title,
  coverUrl: facts.coverUrl,
  coverChosenAt: facts.coverChosenAt,
  authors: facts.authors,
  hasCode: facts.hasCode,
  barcodeRaw: facts.barcodeRaw,
  sharedSourceCoverUrl: facts.sharedSourceCoverUrl,
});
