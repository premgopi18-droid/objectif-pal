import { describe, expect, it } from "vitest";
import { fillMonthGaps } from "./fill-month-gaps";

describe("le comblement des mois sans mouvement", () => {
  it("insère les mois manquants à plat, à la taille du mois précédent", () => {
    expect(
      fillMonthGaps([
        { month: "2026-03", size: 2 },
        { month: "2026-06", size: 1 },
        { month: "2026-07", size: 2 },
      ]),
    ).toEqual([
      { month: "2026-03", size: 2 },
      { month: "2026-04", size: 2 },
      { month: "2026-05", size: 2 },
      { month: "2026-06", size: 1 },
      { month: "2026-07", size: 2 },
    ]);
  });

  it("traverse un changement d'année sans trou ni doublon", () => {
    expect(fillMonthGaps([{ month: "2025-11", size: 1 }, { month: "2026-02", size: 3 }])).toEqual([
      { month: "2025-11", size: 1 },
      { month: "2025-12", size: 1 },
      { month: "2026-01", size: 1 },
      { month: "2026-02", size: 3 },
    ]);
  });

  it("des mois déjà consécutifs ressortent inchangés", () => {
    const points = [
      { month: "2026-06", size: 1 },
      { month: "2026-07", size: 2 },
    ];
    expect(fillMonthGaps(points)).toEqual(points);
  });

  it("zéro ou un point : rien à combler", () => {
    expect(fillMonthGaps([])).toEqual([]);
    expect(fillMonthGaps([{ month: "2026-07", size: 1 }])).toEqual([{ month: "2026-07", size: 1 }]);
  });
});
