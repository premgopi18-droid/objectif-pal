import { describe, expect, it } from "vitest";
import { arcGlyphPlacements, splitGraphemes } from "@/lib/share/arc-layout";

describe("splitGraphemes", () => {
  it("un emoji composé, un drapeau et un accent décomposé restent d'un seul tenant (review #354)", () => {
    expect(splitGraphemes("LÉNA 👩‍🚀")).toEqual(["L", "É", "N", "A", " ", "👩‍🚀"]);
    expect(splitGraphemes("🇫🇷")).toEqual(["🇫🇷"]);
    // « É » saisi en forme décomposée : E + accent aigu combinant.
    expect(splitGraphemes("ÉTÉ")).toEqual(["É", "T", "É"]);
  });

  it("le texte se recompose à l'identique", () => {
    const text = "Capitaine 🏴‍☠️ Barbe-Rousse";
    expect(splitGraphemes(text).join("")).toBe(text);
  });
});

/**
 * Le texte cintré (§4.15) : la géométrie seule, sans canvas. Un mot de six
 * glyphes de 50 px, interlettrage 4 px — largeurs cumulées 0, 54, 108, …
 */
const prefix = [0, 54, 108, 162, 216, 270, 324];
const LETTER_SPACING = 4;

describe("arcGlyphPlacements", () => {
  it("un glyphe par caractère, sa largeur utile sans l'interlettrage", () => {
    const placements = arcGlyphPlacements(prefix, LETTER_SPACING, 2000);
    expect(placements).toHaveLength(6);
    for (const glyph of placements) expect(glyph.width).toBe(50);
  });

  it("symétrique autour du centre du mot : les extrémités descendent autant l'une que l'autre", () => {
    const placements = arcGlyphPlacements(prefix, LETTER_SPACING, 2000);
    const first = placements[0], last = placements[5];
    expect(first.x).toBeCloseTo(-last.x, 9);
    expect(first.y).toBeCloseTo(last.y, 9);
    expect(first.angle).toBeCloseTo(-last.angle, 9);
    // En dôme : les bords sont plus bas que le centre, inclinés vers l'extérieur.
    expect(first.y).toBeGreaterThan(placements[2].y);
    expect(first.angle).toBeLessThan(0);
    expect(last.angle).toBeGreaterThan(0);
  });

  it("la flèche de l'arc suit le rayon : R (1 − cos θ) au bout du mot", () => {
    const radius = 2000;
    const last = arcGlyphPlacements(prefix, LETTER_SPACING, radius)[5];
    // Centre du dernier glyphe : 270 + 25 − 320 / 2 = 135 px d'arc depuis le centre.
    const angle = 135 / radius;
    expect(last.angle).toBeCloseTo(angle, 12);
    expect(last.x).toBeCloseTo(radius * Math.sin(angle), 9);
    expect(last.y).toBeCloseTo(radius * (1 - Math.cos(angle)), 9);
  });

  it("un rayon immense redonne un texte droit : positions de ligne, ni descente ni inclinaison", () => {
    const placements = arcGlyphPlacements(prefix, LETTER_SPACING, 1e12);
    placements.forEach((glyph, index) => {
      expect(glyph.x).toBeCloseTo(prefix[index] + 25 - 160, 6);
      expect(glyph.y).toBeCloseTo(0, 6);
      expect(glyph.angle).toBeCloseTo(0, 9);
    });
  });
});
