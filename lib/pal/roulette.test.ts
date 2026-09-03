import { describe, expect, it } from "vitest";
import type { PalEntry } from "@/lib/pal/derive-pal";
import type { BookCategory } from "@/lib/scoring/types";
import {
  buildReelSequence,
  categoryCounts,
  drawEntry,
  eligibleEntries,
  REEL_LENGTH,
  REEL_WINNER_INDEX,
} from "@/lib/pal/roulette";

/** Une entrée de pile minimale — seuls category et isInProgress comptent ici. */
function entry(title: string, category: BookCategory, isInProgress = false): PalEntry {
  return {
    bookId: `book-${title}`,
    title,
    seriesName: null,
    issueNumber: null,
    category,
    coverUrl: null,
    createdAt: "2026-09-01T00:00:00Z",
    enteredAt: "2026-09-01",
    entrySource: { kind: "purchase", purchaseId: `purchase-${title}` },
    isInProgress,
  };
}

/** Un rng déterministe qui rejoue `values` en boucle. */
function fixedRng(...values: number[]) {
  let calls = 0;
  return () => values[calls++ % values.length];
}

describe("eligibleEntries", () => {
  it("exclut les lectures en cours du tirage", () => {
    const pile = [entry("Dune", "roman"), entry("Berserk", "manga", true)];
    expect(eligibleEntries(pile, new Set()).map((e) => e.title)).toEqual(["Dune"]);
  });

  it("un ensemble vide signifie « toutes les catégories »", () => {
    const pile = [entry("Dune", "roman"), entry("Blacksad", "bd")];
    expect(eligibleEntries(pile, new Set())).toHaveLength(2);
  });

  it("filtre sur une ou plusieurs catégories", () => {
    const pile = [entry("Dune", "roman"), entry("Blacksad", "bd"), entry("Saga", "comics")];
    expect(eligibleEntries(pile, new Set<BookCategory>(["bd"])).map((e) => e.title)).toEqual(["Blacksad"]);
    expect(eligibleEntries(pile, new Set<BookCategory>(["bd", "roman"]))).toHaveLength(2);
  });
});

describe("categoryCounts", () => {
  it("compte par catégorie en excluant les en-cours", () => {
    const pile = [
      entry("Dune", "roman"),
      entry("La Horde", "roman"),
      entry("Berserk", "manga", true),
      entry("Blacksad", "bd"),
    ];
    const counts = categoryCounts(pile);
    expect(counts.get("roman")).toBe(2);
    expect(counts.get("bd")).toBe(1);
    // Le manga en cours ne compte pas : pas de chip fantôme à effectif nul.
    expect(counts.has("manga")).toBe(false);
  });
});

describe("drawEntry", () => {
  it("rend null sur un vivier vide", () => {
    expect(drawEntry([], fixedRng(0.5))).toBeNull();
  });

  it("le rng injecté désigne l'index attendu — équiprobable sur le vivier", () => {
    const pool = [entry("A", "bd"), entry("B", "bd"), entry("C", "bd"), entry("D", "bd")];
    expect(drawEntry(pool, fixedRng(0))?.title).toBe("A");
    expect(drawEntry(pool, fixedRng(0.5))?.title).toBe("C");
    expect(drawEntry(pool, fixedRng(0.999))?.title).toBe("D");
  });
});

describe("buildReelSequence", () => {
  it("produit une bande de longueur fixe avec l'élue à l'index d'arrêt", () => {
    const pool = [entry("A", "bd"), entry("B", "manga"), entry("C", "roman")];
    const winner = pool[1];
    const sequence = buildReelSequence(pool, winner, fixedRng(0.1, 0.7, 0.4));
    expect(sequence).toHaveLength(REEL_LENGTH);
    expect(REEL_WINNER_INDEX).toBeLessThan(REEL_LENGTH);
    expect(sequence[REEL_WINNER_INDEX]).toBe(winner);
  });

  it("ne pioche que dans le vivier", () => {
    const pool = [entry("A", "bd"), entry("B", "manga")];
    const sequence = buildReelSequence(pool, pool[0], fixedRng(0.3, 0.8));
    expect(sequence.every((item) => pool.includes(item))).toBe(true);
  });

  it("tient même avec un vivier d'un seul livre", () => {
    const pool = [entry("Seul", "roman")];
    const sequence = buildReelSequence(pool, pool[0], fixedRng(0.2));
    expect(sequence).toHaveLength(REEL_LENGTH);
    expect(sequence.every((item) => item === pool[0])).toBe(true);
  });
});
