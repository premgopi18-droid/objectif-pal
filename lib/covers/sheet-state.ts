import { isHouseCoverPhotoUrl, isInternalizedCoverUrl } from "@/lib/books/cover-photo";

/**
 * L'état de la feuille « Changer la couverture » (#275), dérivé PUR des faits
 * du livre — testable sans React. Ce que la feuille dit et propose découle
 * d'ici, jamais d'un `if` dans le JSX.
 */

/** D'où vient la couverture affichée. */
export type CoverOrigin =
  /** Pas de couverture : placeholder. */
  | "none"
  /** Une photo de l'exemplaire (ou un import galerie), dans notre bucket. */
  | "photo"
  /** Posée par l'app (cascade, rapatriement #208, réparation #53). */
  | "automatic"
  /** Choisie par l'utilisateur parmi des candidates de source (lot B). */
  | "chosen";

export type CoverSheetState = {
  origin: CoverOrigin;
  /** L'étiquette sous la couverture actuelle. */
  label: string;
  /** « Revenir à l'automatique » n'a de sens que si un choix existe. */
  canReset: boolean;
};

const LABELS: Record<CoverOrigin, string> = {
  none: "Pas encore de couverture",
  photo: "Ma photo",
  automatic: "Couverture automatique",
  chosen: "Couverture choisie",
};

export function deriveCoverSheetState(book: {
  coverUrl: string | null;
  coverChosenAt: string | null;
  supabaseUrl?: string | undefined;
}): CoverSheetState {
  const supabaseUrl = book.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const isChosen = book.coverChosenAt !== null;
  let origin: CoverOrigin;
  if (book.coverUrl === null) {
    origin = "none";
  } else if (isHouseCoverPhotoUrl(book.coverUrl, supabaseUrl) && !isInternalizedCoverUrl(book.coverUrl, supabaseUrl)) {
    // Une photo est toujours un choix ; une photo d'avant #275 (cover_chosen_at
    // nul) reste étiquetée « Ma photo » — c'est ce qu'elle est.
    origin = "photo";
  } else {
    origin = isChosen ? "chosen" : "automatic";
  }
  return { origin, label: LABELS[origin], canReset: isChosen };
}
