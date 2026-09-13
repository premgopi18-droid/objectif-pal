import { describe, expect, it } from "vitest";
import { normalizeSeriesName } from "./normalize";

describe("normalizeSeriesName — la clé de rapprochement, miroir de name_normalized en SQL", () => {
  it.each([
    ["One Piece", "One piece"],
    ["Les Aventures de Tintin", "les aventures de tintin"],
    ["Père & fils", "Pere & fils"],
    ["Le cœur des ténèbres", "Le coeur des tenebres"],
    ["  Berserk   Deluxe ", "berserk deluxe"],
    ["Astérix", "ASTERIX"],
  ])("« %s » et « %s » sont la même série", (left, right) => {
    expect(normalizeSeriesName(left)).toBe(normalizeSeriesName(right));
  });

  it.each([
    ["Berserk", "Berserk (Glénat)"],
    ["Spider-Man", "Spider Man"],
    ["One Piece", "One Piece : édition originale"],
  ])("« %s » et « %s » restent deux séries — pas de rapprochement au jugé", (left, right) => {
    expect(normalizeSeriesName(left)).not.toBe(normalizeSeriesName(right));
  });

  it("rend une clé minuscule, sans accent, aux espaces réduits", () => {
    expect(normalizeSeriesName("  Les   Murailles  Invisibles ")).toBe("les murailles invisibles");
  });
});
