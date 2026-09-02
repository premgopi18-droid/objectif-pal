import { describe, expect, it } from "vitest";
import { CARD_HEIGHT, CARD_WIDTH, SHARE_FONTS, SHARE_THEMES } from "@/lib/share/themes";

/**
 * Les invariants du fichier de coordonnées (§4.15) — tout ce qu'un thème
 * ajouté à la main pourrait casser en silence. La géométrie fine, elle, se
 * valide à l'œil dans le labo de calage (proto + galerie) — ici on grave la
 * STRUCTURE.
 */

describe("SHARE_THEMES", () => {
  it("dix thèmes, identifiants uniques, fonds sous /share/themes/", () => {
    expect(SHARE_THEMES).toHaveLength(10);
    const ids = SHARE_THEMES.map((theme) => theme.id);
    expect(new Set(ids).size).toBe(10);
    for (const theme of SHARE_THEMES) {
      expect(theme.background).toBe(`/share/themes/${theme.id}.webp`);
      expect(theme.label.length).toBeGreaterThan(0);
    }
  });

  it("chaque thème a 7 lignes de tableau croissantes et 3+3 lignes d'objectifs", () => {
    for (const theme of SHARE_THEMES) {
      expect(theme.table.rows).toHaveLength(7);
      for (let i = 1; i < 7; i++) expect(theme.table.rows[i]).toBeGreaterThan(theme.table.rows[i - 1]);
      expect(theme.objectives.textRows).toHaveLength(3);
      expect(theme.objectives.barRows).toHaveLength(3);
      // La jauge d'une ligne vit SOUS sa ligne de valeurs.
      for (let i = 0; i < 3; i++) {
        expect(theme.objectives.barRows[i]).toBeGreaterThan(theme.objectives.textRows[i]);
      }
    }
  });

  it("les boîtes de jauge sont ordonnées et dans le cadre", () => {
    for (const theme of SHARE_THEMES) {
      for (const [start, end] of [theme.objectives.leftBar, theme.objectives.rightBar]) {
        expect(start).toBeLessThan(end);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeLessThanOrEqual(CARD_WIDTH);
      }
      expect(theme.objectives.barHeight).toBeGreaterThan(0);
    }
  });

  it("le masque photo tient dans le cadre 1024×1536", () => {
    for (const theme of SHARE_THEMES) {
      const { cx, cy, rx } = theme.avatar;
      const ry = theme.avatar.ry ?? rx;
      expect(cx - rx).toBeGreaterThanOrEqual(0);
      expect(cx + rx).toBeLessThanOrEqual(CARD_WIDTH);
      expect(cy - ry).toBeGreaterThanOrEqual(0);
      expect(cy + ry).toBeLessThanOrEqual(CARD_HEIGHT);
    }
  });

  it("les zones à rétrécissement automatique ont une largeur max, les corps sont positifs", () => {
    for (const theme of SHARE_THEMES) {
      for (const zone of [theme.name, theme.month, theme.score]) {
        expect(zone.maxWidth).toBeGreaterThan(0);
        expect(zone.style.size).toBeGreaterThan(0);
        // Couleur pleine OU dégradé — jamais les deux, jamais aucun.
        expect(zone.style.color !== undefined || zone.style.gradient !== undefined).toBe(true);
        expect(zone.style.color !== undefined && zone.style.gradient !== undefined).toBe(false);
      }
      expect(theme.objectives.valueStyle.size).toBeGreaterThan(0);
      expect(theme.table.countStyle.size).toBeGreaterThan(0);
    }
  });

  it("chaque police référencée existe dans le registre auto-hébergé", () => {
    for (const theme of SHARE_THEMES) {
      const keys = [
        theme.name.style.font, theme.month.style.font, theme.score.style.font,
        theme.objectives.valueStyle.font, theme.table.countStyle.font,
      ];
      for (const key of keys) expect(SHARE_FONTS[key]).toBeDefined();
    }
  });
});
