import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHARE_THEMES } from "@/lib/share/themes";

/**
 * Le chargement des polices de la carte (§4.15) : une police introuvable
 * dégrade le rendu, elle ne le bloque jamais (review #356 — un client resté
 * sur un ancien bundle peut demander une police retirée depuis).
 * Environnement Node : FontFace et document.fonts sont simulés.
 */

const added: string[] = [];
let missing = new Set<string>();

class FakeFontFace {
  constructor(public family: string, public source: string) {}
  load() {
    const file = this.source.replace(/^url\(.*\//, "").replace(/\)$/, "");
    return missing.has(file) ? Promise.reject(new Error(`404 ${file}`)) : Promise.resolve(this);
  }
}

beforeEach(() => {
  vi.resetModules(); // la mémoire des polices chargées est au niveau du module
  added.length = 0;
  missing = new Set();
  vi.stubGlobal("FontFace", FakeFontFace);
  vi.stubGlobal("document", { fonts: { add: (face: FakeFontFace) => added.push(face.family) } });
});
afterEach(() => vi.unstubAllGlobals());

describe("loadThemeFonts", () => {
  it("charge toutes les polices du thème et n'échoue sur rien", async () => {
    const { loadThemeFonts } = await import("@/lib/share/render-card");
    await expect(loadThemeFonts(SHARE_THEMES[0])).resolves.toEqual([]);
    expect(added.length).toBeGreaterThan(0);
  });

  it("une police absente est signalée, les autres chargées — la promesse ne rejette pas", async () => {
    const { loadThemeFonts } = await import("@/lib/share/render-card");
    const { SHARE_FONTS } = await import("@/lib/share/themes");
    const theme = SHARE_THEMES[0];
    const nameKey = theme.name.style.font;
    missing.add(SHARE_FONTS[nameKey].file);
    const keys = new Set([
      theme.name.style.font, theme.month.style.font, theme.score.style.font,
      theme.objectives.valueStyle.font, theme.table.countStyle.font, theme.table.points.style.font,
    ]);
    const failed = await loadThemeFonts(theme);
    expect(failed).toEqual([nameKey]);
    // Toutes les autres polices du thème sont chargées malgré l'échec.
    expect(added).toHaveLength(keys.size - 1);
  });

  it("un échec n'est pas mémorisé : le rendu suivant retente la police", async () => {
    const { loadThemeFonts } = await import("@/lib/share/render-card");
    const { SHARE_FONTS } = await import("@/lib/share/themes");
    const theme = SHARE_THEMES[1];
    const key = theme.month.style.font;
    missing.add(SHARE_FONTS[key].file);
    expect(await loadThemeFonts(theme)).toContain(key);
    missing.clear();
    expect(await loadThemeFonts(theme)).toEqual([]);
    expect(added).toContain(SHARE_FONTS[key].family);
  });
});
