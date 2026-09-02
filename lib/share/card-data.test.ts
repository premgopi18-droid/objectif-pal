import { describe, expect, it } from "vitest";
import { deriveShareCardData, formatObjectiveCell } from "@/lib/share/card-data";
import type { MonthlyReport } from "@/lib/scoring/types";

/**
 * La carte de partage (§4.15) — la dérivation pure. Le mois d'août 2026 réel
 * (celui des protos) sert de cas nominal : ce que la galerie a validé à l'œil
 * est ce que les tests gravent.
 */

const augustReport: MonthlyReport = {
  month: "2026-08",
  finishedByCategory: { issue: 37, manga: 0, bd: 0, comics: 7, omnibus: 0, roman: 2 },
  readingPoints: 49.5,
  unreadPurchaseCount: 1,
  purchasePenalty: -1,
  objective: {
    progress: [
      { category: "issue", target: 50, finished: 37 },
      { category: "manga", target: 10, finished: 0 },
      { category: "bd", target: 3, finished: 0 },
      { category: "comics", target: 6, finished: 7 },
      { category: "roman", target: 1, finished: 2 },
    ],
    achieved: false,
    bonus: 0,
  },
  total: 48.5,
};

describe("deriveShareCardData", () => {
  it("le mois d'août réel : pseudo et date en capitales accentuées, score à la virgule", () => {
    const card = deriveShareCardData(augustReport, "Premou");
    expect(card.name).toBe("PREMOU");
    expect(card.monthLabel).toBe("AOÛT 2026");
    expect(card.score).toBe("+48,5");
  });

  it("les objectifs suivent l'ordre des fonds, l'omnibus sans cible est null", () => {
    const card = deriveShareCardData(augustReport, "Premou");
    expect(card.objectives).toHaveLength(6);
    // Ordre : issue, manga, bd, comics, omnibus, roman.
    expect(card.objectives[0]).toEqual({ finished: 37, target: 50, ratio: 37 / 50 });
    expect(card.objectives[4]).toBeNull();
    expect(formatObjectiveCell(card.objectives[4])).toBe("—");
    expect(formatObjectiveCell(card.objectives[0])).toBe("37 / 50");
  });

  it("une cible dépassée plafonne sa jauge à 1 — la valeur texte garde le dépassement", () => {
    const card = deriveShareCardData(augustReport, "Premou");
    expect(card.objectives[3]).toEqual({ finished: 7, target: 6, ratio: 1 });
    expect(card.objectives[5]).toEqual({ finished: 2, target: 1, ratio: 1 });
    expect(formatObjectiveCell(card.objectives[3])).toBe("7 / 6");
  });

  it("les 7 compteurs : les 6 catégories puis l'achat non lu", () => {
    const card = deriveShareCardData(augustReport, "Premou");
    expect(card.counts).toEqual([37, 0, 0, 7, 0, 2, 1]);
  });

  it("sans objectif déclaré, les 6 cellules sont « — »", () => {
    const card = deriveShareCardData({ ...augustReport, objective: null }, "Premou");
    expect(card.objectives).toEqual([null, null, null, null, null, null]);
  });

  it("un mois négatif s'écrit avec le signe moins typographique, un mois nul « 0 »", () => {
    expect(deriveShareCardData({ ...augustReport, total: -2 }, "x").score).toBe("−2");
    expect(deriveShareCardData({ ...augustReport, total: 0 }, "x").score).toBe("0");
  });
});
