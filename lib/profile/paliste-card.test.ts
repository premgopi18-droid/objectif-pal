import { describe, expect, it } from "vitest";
import { derivePalisteCard } from "./paliste-card";
import type { StoredMonthlyReport } from "@/lib/scoring/closed-months";

/** Une ligne d'agrégat minimale — seuls `month`, `total` et les terminées comptent ici. */
const stored = (month: string, total: number, finishedCount = 0): StoredMonthlyReport => ({
  report: {
    month,
    finishedByCategory: { issue: 0, manga: 0, bd: 0, comics: 0, omnibus: 0, roman: 0 },
    readingPoints: total,
    unreadPurchaseCount: 0,
    purchasePenalty: 0,
    objective: null,
    total,
  },
  finishedReadings: Array.from({ length: finishedCount }, (_, index) => ({
    readingId: `r-${month}-${index}`,
    title: `Titre ${index}`,
  })),
});

describe("derivePalisteCard", () => {
  it("cumule distinctions, lectures et total de l'année civile", () => {
    const card = derivePalisteCard(
      [stored("2025-12", 10, 3), stored("2026-01", 3.5, 2), stored("2026-07", -1, 1)],
      [
        { month: "2025-12", kind: "favorite" },
        { month: "2026-01", kind: "favorite" },
        { month: "2026-07", kind: "bad_surprise" },
      ],
      "2026-08",
    );
    expect(card.distinctionCounts).toEqual({ favorite: 2, good_surprise: 0, bad_surprise: 1 });
    expect(card.readingCount).toBe(6);
    expect(card.year).toBe("2026");
    expect(card.yearTotal).toBe(2.5); // 2025-12 hors année civile
  });

  it("le meilleur mois : le score le plus haut, et à égalité le plus RÉCENT", () => {
    const card = derivePalisteCard([stored("2026-03", 8), stored("2026-01", 8), stored("2026-02", 5)], [], "2026-08");
    expect(card.bestMonth).toEqual({ month: "2026-03", total: 8 });
  });

  it("janvier : l'année n'a aucun mois clos → total 0, le reste vit sur l'historique", () => {
    const card = derivePalisteCard([stored("2025-11", 7, 2), stored("2025-12", 4, 1)], [], "2026-01");
    expect(card.yearTotal).toBe(0);
    expect(card.bestMonth).toEqual({ month: "2025-11", total: 7 });
    expect(card.readingCount).toBe(3);
  });

  it("une distinction du mois COURANT ne compte pas — la carte ne spoile pas le reveal", () => {
    const card = derivePalisteCard([], [{ month: "2026-08", kind: "favorite" }], "2026-08");
    expect(card.distinctionCounts.favorite).toBe(0);
  });

  it("compte sans aucun mois clos : la carte à zéro, pas de meilleur mois", () => {
    const card = derivePalisteCard([], [], "2026-08");
    expect(card).toEqual({
      distinctionCounts: { favorite: 0, good_surprise: 0, bad_surprise: 0 },
      bestMonth: null,
      year: "2026",
      yearTotal: 0,
      readingCount: 0,
    });
  });
});
