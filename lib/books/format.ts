/**
 * Formats d'affichage d'un livre — helpers PURS, client-safe (aucun import
 * serveur) : les vignettes du journal, de la PAL et de la feuille de scan
 * composent toutes le même sous-titre.
 */

/**
 * « Série #N · détail » — le sous-titre standard d'une vignette de livre.
 * `detail` est le complément propre à chaque écran (libellé de catégorie,
 * éditeur…) ; chaque morceau absent disparaît proprement.
 */
export function formatBookSubtitle(seriesName: string | null, issueNumber: string | null, detail: string | null): string {
  return [seriesName && issueNumber ? `${seriesName} #${issueNumber}` : seriesName, detail].filter(Boolean).join(" · ");
}
