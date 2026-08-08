import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Contrat anti-régression des garde-fous plateforme (#167), dans l'esprit de
 * celui du scanner (#60) : ces deux règles se cassent en SILENCE. Aucun test
 * fonctionnel ne bronche, le build passe, le lint passe — seul un iPhone voit
 * le bug, et seulement après installation en PWA. D'où des assertions sur la
 * forme du code lui-même.
 *
 * On lit les fichiers en texte plutôt que d'importer `app/layout.tsx` : celui-ci
 * tire `next/font/google`, qui ne se résout pas hors du build Next.
 */

// Commentaires retirés : ils PARLENT de `@layer` et du plancher (c'est même leur
// rôle), et feraient matcher les assertions structurelles sur de la prose.
const stripCssComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const globalsCss = stripCssComments(readFileSync(new URL("./globals.css", import.meta.url), "utf8"));
const layoutSource = readFileSync(new URL("./layout.tsx", import.meta.url), "utf8");

describe("les garde-fous plateforme (design-specs §6)", () => {
  it("impose un plancher de 16px sur les champs de saisie — sous ce seuil iOS zoome au focus", () => {
    expect(globalsCss).toMatch(/input,\s*select,\s*textarea\s*\{[^}]*font-size:\s*max\(16px/);
  });

  it("garde ce plancher HORS @layer — layeré, les utilitaires Tailwind reprendraient la main", () => {
    // Toutes les règles @layer du fichier, contenu compris (une seule imbrication :
    // pas de @layer dans @layer ici). Si le plancher atterrit dans l'une d'elles,
    // `text-sm` sur un champ redevient gagnant et le zoom iOS revient.
    const layerBlocks = globalsCss.match(/@layer[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g) ?? [];

    for (const block of layerBlocks) {
      expect(block).not.toMatch(/font-size:\s*max\(16px/);
    }
  });

  it("plafonne le zoom à 1 dans le viewport — retrait prévu et EXPLICITE (#169)", () => {
    // Ce test tombera le jour du retrait : c'est le but. Il force la décision à
    // être prise, plutôt que de laisser traîner un plafond a11y indéfiniment.
    expect(layoutSource).toMatch(/maximumScale:\s*1/);
  });
});
