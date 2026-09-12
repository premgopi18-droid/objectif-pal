import { isHouseCoverPhotoUrl, isInternalizedCoverUrl, isSharedCoverUrl } from "@/lib/books/cover-photo";

/**
 * L'état de partage d'une couverture (#278, lot D), dérivé PUR — ce que la
 * feuille affiche sous la couverture actuelle.
 *
 * Décisions du 12/09/2026 :
 *  - une contribution est PROPOSÉE aux autres, jamais imposée ;
 *  - partager une PHOTO est opt-in (case décochée : une photo peut montrer
 *    une main, un salon) ; une couverture RAPATRIÉE d'une source se partage
 *    par défaut (elle ne vient pas de chez l'utilisateur) ;
 *  - une couverture déjà prise au pool (`shared/`) ne se re-partage pas —
 *    elle y est ; une couverture externe non rapatriée attend la nuit.
 */

export type CoverShareState = {
  /** La couverture peut être partagée : elle vit chez nous et le livre a un code. */
  shareable: boolean;
  /** Une contribution vivante reflète CETTE couverture. */
  shared: boolean;
  /** Ce que la case propose avant tout geste : cochée pour une rapatriée, décochée pour une photo. */
  defaultChecked: boolean;
  /** Une contribution vivante existe mais pour une ANCIENNE couverture : proposer de partager la nouvelle. */
  stale: boolean;
};

export function deriveShareState(book: {
  coverUrl: string | null;
  barcodeRaw: string | null;
  /** La couverture-source de la contribution vivante de l'utilisateur pour ce code, s'il y en a une. */
  sharedSourceCoverUrl: string | null;
  supabaseUrl?: string | undefined;
}): CoverShareState {
  const supabaseUrl = book.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const none = { shareable: false, shared: false, defaultChecked: false, stale: false };
  if (book.coverUrl === null || book.barcodeRaw === null) return none;
  if (!isHouseCoverPhotoUrl(book.coverUrl, supabaseUrl) || isSharedCoverUrl(book.coverUrl, supabaseUrl)) return none;
  const shared = book.sharedSourceCoverUrl !== null && book.sharedSourceCoverUrl === book.coverUrl;
  const stale = book.sharedSourceCoverUrl !== null && !shared;
  return {
    shareable: true,
    shared,
    defaultChecked: isInternalizedCoverUrl(book.coverUrl, supabaseUrl),
    stale,
  };
}

/** L'étiquette d'une contribution dans la feuille : le pseudo (cercle rejoint) ou l'anonymat. */
export const contributionLabel = (displayName: string | null): string =>
  displayName !== null && displayName.trim().length > 0 ? `Photo de ${displayName.trim()}` : "Photo d'un·e lecteur·ice";
