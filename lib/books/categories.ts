import type { BookCategory } from "@/lib/scoring/types";

/** Les six catégories du barème, dans l'ordre d'affichage, avec leur libellé UI. */
export const CATEGORY_LABELS: Record<BookCategory, string> = {
  issue: "Issue",
  manga: "Manga",
  bd: "BD",
  comics: "Comics",
  omnibus: "Omnibus",
  roman: "Roman",
};

// La liste elle-même vit avec le barème (source unique) — re-exportée ici par commodité.
export { ALL_CATEGORIES } from "@/lib/scoring/types";
