import type { BookCategory } from "@/lib/scoring/types";

/**
 * L'alignement de catégorie par série (#257) — la partie PURE : ce que la
 * feuille de proposition affiche, et rien d'autre. Le ciblage du lot vit en
 * SQL (`applyCategoryToSeries` : `series_name` égal, catégorie différente,
 * scopé user) ; le COMPTE vient du serveur (`updateBookDetails` le renvoie
 * après l'enregistrement) — la Biblio n'affiche que l'inventaire, un compte
 * client aurait raté les emprunts lus de la même série.
 */

/** Ce que l'enregistrement d'une fiche renvoie quand la série diverge. */
export type SeriesAlignProposal = {
  /** Le nom de série SAUVÉ (normalisé par prepareBookEdit) — la clé exacte du lot. */
  seriesName: string;
  category: BookCategory;
  /** Les AUTRES livres de la série qui portent une autre catégorie. */
  divergentCount: number;
};

/**
 * Les textes de la feuille — accordés au compte, le libellé de catégorie en
 * paramètre (la vérité des libellés reste CATEGORY_LABELS, pas ici).
 */
export function seriesAlignSheetCopy(
  proposal: SeriesAlignProposal,
  categoryLabel: string,
): { title: string; body: string; cta: string } {
  const { seriesName, divergentCount } = proposal;
  const plural = divergentCount > 1;
  return {
    title: `Toute la série en « ${categoryLabel} » ?`,
    body: plural
      ? `${divergentCount} autres tomes de « ${seriesName} » ont une autre catégorie. Les points de leurs lectures suivront la nouvelle.`
      : `1 autre tome de « ${seriesName} » a une autre catégorie. Les points de ses lectures suivront la nouvelle.`,
    cta: plural ? `Appliquer aux ${divergentCount} tomes` : "Appliquer à l'autre tome",
  };
}

/**
 * Le toast après application — sur le compte RÉEL renvoyé par l'UPDATE, jamais
 * sur celui de la proposition : entre la feuille et le tap, un autre onglet a
 * pu bouger.
 */
export function seriesAlignedToastMessage(updated: number, categoryLabel: string): string {
  // 0 = un autre onglet a déjà aligné entre la proposition et le tap : un
  // fait à annoncer, pas un « 0 tome passé » qui sonnerait comme un échec.
  if (updated === 0) return "La série était déjà alignée.";
  const plural = updated > 1 ? "s" : "";
  return `${updated} tome${plural} passé${plural} en « ${categoryLabel} » ✓`;
}
