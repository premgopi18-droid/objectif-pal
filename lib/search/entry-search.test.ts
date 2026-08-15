import { describe, expect, it } from "vitest";
import { escapeIlikePattern, matchesSearch, normalizeForSearch } from "./entry-search";

/** La recherche commune (#222) — accents, ligatures, jokers : les trois pièges. */

const get = {
  title: (entry: { title: string; seriesName: string | null }) => entry.title,
  seriesName: (entry: { title: string; seriesName: string | null }) => entry.seriesName,
};

describe("normalizeForSearch", () => {
  it("accents et casse tombent — « asterix » trouve Astérix", () => {
    expect(normalizeForSearch("Astérix")).toBe("asterix");
    expect(normalizeForSearch("Père & fils")).toBe("pere & fils");
  });

  it("les ligatures suivent unaccent (parité SQL, #222) : cœur → coeur", () => {
    expect(normalizeForSearch("Cœur de pierre")).toBe("coeur de pierre");
    expect(normalizeForSearch("Ægir")).toBe("aegir");
  });
});

describe("matchesSearch", () => {
  const entry = { title: "La Dernière Flamme", seriesName: "Les Chroniques" };

  it("titre OU série, aiguille vide = tout passe", () => {
    expect(matchesSearch(entry, "flamme", get)).toBe(true);
    expect(matchesSearch(entry, "chroniques", get)).toBe(true);
    expect(matchesSearch(entry, "  ", get)).toBe(true);
    expect(matchesSearch(entry, "zelda", get)).toBe(false);
  });

  it("une série absente ne matche rien mais ne crashe pas", () => {
    expect(matchesSearch({ title: "Solo", seriesName: null }, "chroniques", get)).toBe(false);
  });
});

describe("escapeIlikePattern", () => {
  it("« 100% » et « Mister_X » cherchent leurs caractères, pas des jokers", () => {
    expect(escapeIlikePattern("100%")).toBe("100\\%");
    expect(escapeIlikePattern("Mister_X")).toBe("Mister\\_X");
    expect(escapeIlikePattern("a\\b")).toBe("a\\\\b");
  });
});
