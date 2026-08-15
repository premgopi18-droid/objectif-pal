import { describe, expect, it } from "vitest";
import { parseStoredMonthlyReport } from "./stored-report";

/** Une ligne d'agrégat valide, telle que `buildStoredMonthlyReport` l'écrit. */
const validStored = () => ({
  report: {
    month: "2026-07",
    finishedByCategory: { issue: 0, manga: 2, bd: 1, comics: 0, omnibus: 0, roman: 0 },
    readingPoints: 3.5,
    unreadPurchaseCount: 2,
    purchasePenalty: -2,
    objective: {
      progress: [{ category: "manga", target: 2, finished: 2 }],
      achieved: true,
      bonus: 3,
    },
    total: 4.5,
  },
  finishedReadings: [{ readingId: "r1", title: "One Piece T.1" }],
});

describe("parseStoredMonthlyReport", () => {
  it("accepte une ligne écrite par buildStoredMonthlyReport", () => {
    const parsed = parseStoredMonthlyReport(validStored());
    expect(parsed).not.toBeNull();
    expect(parsed?.report.total).toBe(4.5);
    expect(parsed?.report.objective?.achieved).toBe(true);
    expect(parsed?.finishedReadings).toEqual([{ readingId: "r1", title: "One Piece T.1" }]);
  });

  it("accepte un objectif absent (null) et des catégories manquantes (zéro par défaut)", () => {
    const stored = validStored();
    stored.report.objective = null as never;
    delete (stored.report.finishedByCategory as Record<string, unknown>).roman;
    const parsed = parseStoredMonthlyReport(stored);
    expect(parsed?.report.objective).toBeNull();
    expect(parsed?.report.finishedByCategory.roman).toBe(0);
  });

  it("ignore une catégorie inconnue (tolérance : elle ne casse rien)", () => {
    const stored = validStored();
    (stored.report.finishedByCategory as Record<string, unknown>).poésie = 4;
    expect(parseStoredMonthlyReport(stored)).not.toBeNull();
  });

  it("rejette ce qui fausserait un chiffre affiché : total non numérique, jauge illisible", () => {
    const badTotal = validStored();
    (badTotal.report as Record<string, unknown>).total = "12";
    expect(parseStoredMonthlyReport(badTotal)).toBeNull();

    const badGauge = validStored();
    (badGauge.report.objective as Record<string, unknown>).progress = [{ category: "manga", target: "2", finished: 2 }];
    expect(parseStoredMonthlyReport(badGauge)).toBeNull();

    const badCount = validStored();
    (badCount.report.finishedByCategory as Record<string, unknown>).manga = "deux";
    expect(parseStoredMonthlyReport(badCount)).toBeNull();
  });

  it("rejette les formes qui ne sont pas une ligne d'agrégat", () => {
    expect(parseStoredMonthlyReport(null)).toBeNull();
    expect(parseStoredMonthlyReport("{}")).toBeNull();
    expect(parseStoredMonthlyReport({ report: {}, finishedReadings: [] })).toBeNull();
    expect(parseStoredMonthlyReport({ report: validStored().report, finishedReadings: [{ title: 42 }] })).toBeNull();
  });
});
