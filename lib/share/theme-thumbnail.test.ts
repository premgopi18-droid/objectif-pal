import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SHARE_BACKGROUND_VERSION, SHARE_THEMES } from "./themes";
import { themeThumbnailUrl } from "./theme-thumbnail";

/**
 * Les vignettes des thèmes (fluidité #331, item 9) : l'URL dérivée du fond, et
 * le fichier qui doit exister pour CHAQUE thème — une vignette manquante
 * afficherait une image cassée dans le sélecteur.
 */
describe("themeThumbnailUrl", () => {
  it("suffixe le fond par -thumb, versionné comme le fond (cache HTTP, review #352)", () => {
    expect(themeThumbnailUrl("/share/themes/theme_4.webp")).toBe(
      `/share/themes/theme_4-thumb.webp?v=${SHARE_BACKGROUND_VERSION}`,
    );
  });

  it("chaque thème a sa vignette dans public/ (scripts/gen-share-thumbs.mjs)", () => {
    for (const theme of SHARE_THEMES) {
      const file = join(process.cwd(), "public", themeThumbnailUrl(theme.background).split("?")[0]);
      expect(existsSync(file), `vignette absente : ${file}`).toBe(true);
    }
  });
});
