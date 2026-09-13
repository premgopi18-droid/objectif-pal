import { describe, expect, it } from "vitest";
import { findMergeCandidates, mergeKey, pairKey, type MergeCandidateSeries } from "./merge-candidates";

const series = (seriesId: string, name: string, overrides: Partial<MergeCandidateSeries> = {}): MergeCandidateSeries => ({
  seriesId,
  name,
  volumeCount: 1,
  hasGcdId: false,
  ...overrides,
});

describe("findMergeCandidates — les graphies à proposer", () => {
  it("« Berserk » et « Berserk (Glénat) » : une paire, la plus peuplée conservée", () => {
    const pairs = findMergeCandidates([series("a", "Berserk (Glénat)", { volumeCount: 1 }), series("b", "Berserk", { volumeCount: 4 })]);
    expect(pairs).toEqual([{ keep: series("b", "Berserk", { volumeCount: 4 }), merge: series("a", "Berserk (Glénat)") }]);
  });

  it("la série qui porte un identifiant GCD est celle qu'on garde, même moins peuplée", () => {
    const pairs = findMergeCandidates([series("a", "One piece", { volumeCount: 12 }), series("b", "One Piece", { hasGcdId: true })]);
    expect(pairs[0].keep.seriesId).toBe("b");
  });

  it("deux identifiants GCD : jamais proposées (deux séries, pas une graphie)", () => {
    expect(findMergeCandidates([series("a", "Spider-Man", { hasGcdId: true }), series("b", "Spider-Man", { hasGcdId: true })])).toEqual([]);
  });

  it("« Spider-Man » et « Spider Man » restent deux séries — pas de rapprochement au jugé", () => {
    expect(findMergeCandidates([series("a", "Spider-Man"), series("b", "Spider Man")])).toEqual([]);
  });

  it("une paire ignorée (« Ce sont deux séries ») ne revient pas", () => {
    const list = [series("a", "Berserk"), series("b", "Berserk (Glénat)")];
    const [pair] = findMergeCandidates(list);
    expect(findMergeCandidates(list, new Set([pairKey(pair)]))).toEqual([]);
  });

  it("la clé élargie retire seulement un suffixe entre parenthèses, en fin de nom", () => {
    expect(mergeKey("Berserk (Glénat)")).toBe("berserk");
    expect(mergeKey("Berserk (Glénat) deluxe")).toBe("berserk (glenat) deluxe");
    expect(mergeKey("  Astérix  ")).toBe("asterix");
  });
});
