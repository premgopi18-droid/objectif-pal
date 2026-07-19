import { GCD_UNNUMBERED_ISSUE_NUMBER } from "@/lib/resolution/types";

/**
 * Formats d'affichage d'un livre — helpers PURS, client-safe (aucun import
 * serveur) : les vignettes du journal, de la PAL et de la feuille de scan
 * composent toutes le même sous-titre.
 */

/**
 * Le numéro AFFICHABLE d'un fascicule — traduit le marqueur GCD « [nn] »
 * (sans numéro, issue #58) en absence : défense pour les livres stockés avant
 * la normalisation à la résolution.
 */
export function displayableIssueNumber(issueNumber: string | null): string | null {
  return issueNumber === GCD_UNNUMBERED_ISSUE_NUMBER ? null : issueNumber;
}

/**
 * « Série #N · détail » — le sous-titre standard d'une vignette de livre.
 * `detail` est le complément propre à chaque écran (libellé de catégorie,
 * éditeur…) ; chaque morceau absent disparaît proprement.
 */
export function formatBookSubtitle(seriesName: string | null, issueNumber: string | null, detail: string | null): string {
  const number = displayableIssueNumber(issueNumber);
  return [seriesName && number ? `${seriesName} #${number}` : seriesName, detail].filter(Boolean).join(" · ");
}
