import { describe, expect, it } from "vitest";
import { aniListRunExitCode, majorityCategory, selectAniListTargets, type AniListTarget } from "./series-anilist-plan.mjs";

const NOW = new Date("2026-09-14T06:30:00Z");
const target = (name: string, overrides: Partial<AniListTarget> = {}): AniListTarget => ({
  seriesId: `s-${name}`,
  name,
  aniListId: null,
  lastSearchedAt: null,
  factSource: "human",
  hasFact: false,
  ...overrides,
});

describe("selectAniListTargets — priorité humain > AniList > GCD, relecture par id d'abord", () => {
  it("écarte les faits humains, garde les faits GCD et AniList (remplaçables)", () => {
    const picked = selectAniListTargets(
      [
        target("Humain", { hasFact: true, factSource: "human" }),
        target("GCD", { hasFact: true, factSource: "gcd" }),
        target("AniList", { hasFact: true, factSource: "anilist", aniListId: 7 }),
      ],
      NOW,
    );
    expect(picked.map((entry) => entry.name)).toEqual(["AniList", "GCD"]);
  });

  it("une série non rapprochée n'est retentée qu'après une semaine", () => {
    const picked = selectAniListTargets(
      [
        target("Hier", { lastSearchedAt: "2026-09-13T06:30:00Z" }),
        target("Il y a dix jours", { lastSearchedAt: "2026-09-04T06:30:00Z" }),
        target("Jamais"),
      ],
      NOW,
    );
    expect(picked.map((entry) => entry.name)).toEqual(["Jamais", "Il y a dix jours"]);
  });

  it("borne le run", () => {
    expect(selectAniListTargets([target("A"), target("B"), target("C")], NOW, 2)).toHaveLength(2);
  });
});

describe("majorityCategory", () => {
  it("la majorité, la première rencontrée à égalité, null sans livre", () => {
    expect(majorityCategory(["manga", "bd", "manga"])).toBe("manga");
    expect(majorityCategory(["bd", "manga"])).toBe("bd");
    expect(majorityCategory([])).toBeNull();
  });
});

describe("aniListRunExitCode", () => {
  it("rouge sur panne généralisée ou erreur de notre côté, pas sur absence", () => {
    expect(aniListRunExitCode({ processed: 10, matched: 0, unmatched: 10, declared: 0, networkErrors: 0, infraErrors: 0 })).toBe(0);
    expect(aniListRunExitCode({ processed: 3, matched: 0, unmatched: 0, declared: 0, networkErrors: 3, infraErrors: 0 })).toBe(1);
    expect(aniListRunExitCode({ processed: 3, matched: 2, unmatched: 0, declared: 2, networkErrors: 0, infraErrors: 1 })).toBe(1);
  });
});
