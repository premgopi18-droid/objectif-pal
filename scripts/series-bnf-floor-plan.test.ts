import { describe, expect, it } from "vitest";
import { authorSearchName, floorRunExitCode, oldestCheckedAt, selectFloorTargets, type FloorTarget } from "./series-bnf-floor-plan.mjs";

const target = (name: string, oldestCheckedAt: string | null): FloorTarget => ({
  seriesId: `s-${name}`,
  name,
  author: null,
  bnfSeriesIds: ["1"],
  oldestCheckedAt,
});

describe("selectFloorTargets — jamais relues d'abord, puis les plus anciennes, bornées", () => {
  it("ordonne et coupe", () => {
    const picked = selectFloorTargets(
      [target("Zed", "2026-09-10"), target("Berserk", null), target("Akira", "2026-09-01"), target("One Piece", null)],
      3,
    );
    expect(picked.map((entry) => entry.name)).toEqual(["Berserk", "One Piece", "Akira"]);
  });
});

describe("oldestCheckedAt — null dès qu'une édition n'a jamais été relue (review #300)", () => {
  it("prend la plus ancienne, ou null", () => {
    expect(oldestCheckedAt(["2026-09-10T00:00:00Z", "2026-09-01T00:00:00Z"])).toBe("2026-09-01T00:00:00Z");
    expect(oldestCheckedAt(["2026-09-10T00:00:00Z", null])).toBeNull();
    expect(oldestCheckedAt([null])).toBeNull();
    expect(oldestCheckedAt([])).toBeNull();
  });
});

describe("authorSearchName — le nom de famille du premier auteur", () => {
  it.each([
    ["Eiichirō Oda, Djamel Rabahi", "Oda"],
    ["Stephen King", "King"],
    ["scénario, Alex Chauvel ; dessin, Ludovic Rio", "Chauvel"],
    ["Q-Hayashida", "Q-Hayashida"],
    ["Bill Willingham & Mark Buckingham", "Willingham"],
    ["Tagawa, Mi (1982-....). Auteur du texte", "Tagawa"],
  ])("« %s » → %s", (authors, expected) => {
    expect(authorSearchName(authors)).toBe(expected);
  });

  it("rend null sans auteur exploitable", () => {
    expect(authorSearchName(null)).toBeNull();
    expect(authorSearchName("")).toBeNull();
    expect(authorSearchName("scénario")).toBeNull();
    expect(authorSearchName("X")).toBeNull();
  });
});

describe("floorRunExitCode — rouge sur panne, pas sur absence", () => {
  it("un run sans plancher trouvé est vert", () => {
    expect(floorRunExitCode({ processed: 10, updated: 0, missing: 10, networkErrors: 0, infraErrors: 0 })).toBe(0);
  });
  it("une erreur de notre côté est rouge", () => {
    expect(floorRunExitCode({ processed: 10, updated: 9, missing: 0, networkErrors: 0, infraErrors: 1 })).toBe(1);
  });
  it("tout le réseau en échec est rouge, un échec isolé ne l'est pas", () => {
    expect(floorRunExitCode({ processed: 5, updated: 0, missing: 0, networkErrors: 5, infraErrors: 0 })).toBe(1);
    expect(floorRunExitCode({ processed: 5, updated: 4, missing: 0, networkErrors: 1, infraErrors: 0 })).toBe(0);
  });
  it("un run vide est vert", () => {
    expect(floorRunExitCode({ processed: 0, updated: 0, missing: 0, networkErrors: 0, infraErrors: 0 })).toBe(0);
  });
});
