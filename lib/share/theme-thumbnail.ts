/**
 * L'URL de la VIGNETTE d'un fond de thème (fluidité #331, item 9) : le même
 * chemin, suffixé `-thumb`, produit par `scripts/gen-share-thumbs.mjs` à 128 px
 * de large. Le sélecteur de thème l'affiche à la place du fond pleine taille
 * (45 à 385 Ko chacun) ; le fond, lui, n'est chargé que par le rendu canvas du
 * thème choisi.
 */
export const THEME_THUMBNAIL_SUFFIX = "-thumb";

export function themeThumbnailUrl(background: string): string {
  return background.replace(/\.webp$/, `${THEME_THUMBNAIL_SUFFIX}.webp`);
}
