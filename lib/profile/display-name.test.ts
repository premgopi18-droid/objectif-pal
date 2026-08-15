import { describe, expect, it } from "vitest";
import { DISPLAY_NAME_MAX_LENGTH, normalizeDisplayName } from "./display-name";

/** Le pseudo (#224) : montré aux autres — la normalisation est le garde-fou. */

describe("normalizeDisplayName", () => {
  it("trim et espaces internes réduits", () => {
    expect(normalizeDisplayName("  Léna   du plateau  ")).toEqual({ ok: true, value: "Léna du plateau" });
  });

  it("un pseudo ordinaire passe tel quel", () => {
    expect(normalizeDisplayName("Prem")).toEqual({ ok: true, value: "Prem" });
  });

  it("vide (ou blanc) = refusé", () => {
    expect(normalizeDisplayName("").ok).toBe(false);
    expect(normalizeDisplayName("   ").ok).toBe(false);
  });

  it("borné en longueur — la limite exacte passe, au-delà non", () => {
    expect(normalizeDisplayName("x".repeat(DISPLAY_NAME_MAX_LENGTH)).ok).toBe(true);
    expect(normalizeDisplayName("x".repeat(DISPLAY_NAME_MAX_LENGTH + 1)).ok).toBe(false);
  });
});
