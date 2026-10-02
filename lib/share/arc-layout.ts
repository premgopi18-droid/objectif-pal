/**
 * Le texte CINTRÉ de la carte de partage (§4.15, thème « Carte au trésor ») —
 * placement pur, sans canvas : chaque glyphe est posé sur un cercle dont le
 * centre est SOUS le texte (arc en dôme, les extrémités descendent), et
 * incliné sur sa tangente. Les positions sont relatives au centre du mot, sur
 * sa ligne de base ; le moteur de rendu les applique telles quelles.
 *
 * L'avance vient des largeurs CUMULÉES (`prefixWidths[i]` = largeur des i
 * premiers caractères, interlettrage compris) : le crénage du mot est
 * conservé, ce qu'un mesurage lettre par lettre perdrait.
 */

/**
 * Les GRAPHÈMES du texte — l'unité que l'œil lit comme un caractère, donc
 * celle que l'arc doit poser d'un bloc (review #354). Un découpage en points
 * de code éclaterait un emoji composé (👩‍🚀 = 👩 + ZWJ + 🚀), un drapeau (deux
 * lettres régionales) ou un accent décomposé (E + ◌́, fréquent au copier-coller)
 * — et rien n'interdit ces caractères dans un pseudo ou un nom d'invité.
 * Locale non posée : le découpage en graphèmes ne dépend pas de la langue.
 */
export function splitGraphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map((part) => part.segment);
  }
  return [...text];
}

export type ArcGlyphPlacement = {
  /** Décalage horizontal du centre du glyphe, depuis le centre du mot. */
  x: number;
  /** Descente du glyphe sous la ligne de base du centre (≥ 0). */
  y: number;
  /** Inclinaison en radians (négative à gauche, positive à droite). */
  angle: number;
  /** Largeur utile du glyphe (sans l'interlettrage qui le suit). */
  width: number;
};

/**
 * @param prefixWidths n + 1 valeurs croissantes : 0, puis la largeur des 1, 2, … n premiers caractères.
 * @param letterSpacing l'interlettrage en px, compté après CHAQUE glyphe par le canvas.
 * @param radius le rayon du cercle, en px (plus il est grand, plus l'arc est plat).
 */
export function arcGlyphPlacements(prefixWidths: number[], letterSpacing: number, radius: number): ArcGlyphPlacement[] {
  const count = prefixWidths.length - 1;
  // La largeur utile du mot : l'interlettrage traînant du dernier glyphe ne compte pas.
  const total = prefixWidths[count] - letterSpacing;
  const placements: ArcGlyphPlacement[] = [];
  for (let index = 0; index < count; index++) {
    const width = prefixWidths[index + 1] - prefixWidths[index] - letterSpacing;
    // Longueur d'arc du centre du glyphe depuis le centre du mot.
    const arcLength = prefixWidths[index] + width / 2 - total / 2;
    const angle = arcLength / radius;
    placements.push({
      x: radius * Math.sin(angle),
      y: radius * (1 - Math.cos(angle)),
      angle,
      width,
    });
  }
  return placements;
}
