import { describe, expect, it } from "vitest";
import { deriveShareCardData } from "@/lib/share/card-data";
import { buildGuestReport, type GuestCardInput } from "@/lib/share/guest-report";
import { SCORING_SCALE } from "@/lib/scoring/scale";

/**
 * La carte d'invité (§4.15) — les compteurs du formulaire passent par le VRAI
 * moteur. Les tests vérifient la parité avec le barème (jamais recopié ici :
 * les attentes se lisent depuis `SCORING_SCALE`) et la chaîne complète
 * jusqu'aux données de carte.
 */

const baseInput: GuestCardInput = {
  month: "2026-09",
  finishedByCategory: { issue: 4, manga: 2, bd: 1, comics: 3, omnibus: 0, roman: 1 },
  unreadPurchaseCount: 2,
  objective: null,
};

describe("buildGuestReport", () => {
  it("les compteurs deviennent le bilan, au barème exact", () => {
    const report = buildGuestReport(baseInput);
    expect(report.month).toBe("2026-09");
    expect(report.finishedByCategory).toEqual(baseInput.finishedByCategory);
    const scale = SCORING_SCALE.pointsByCategory;
    expect(report.readingPoints).toBe(4 * scale.issue + 2 * scale.manga + 1 * scale.bd + 3 * scale.comics + 1 * scale.roman);
    expect(report.unreadPurchaseCount).toBe(2);
    expect(report.purchasePenalty).toBe(2 * SCORING_SCALE.unreadPurchasePenalty);
    expect(report.objective).toBeNull();
    expect(report.total).toBe(report.readingPoints + report.purchasePenalty);
  });

  it("l'objectif atteint partout déclenche le bonus all-or-nothing", () => {
    const report = buildGuestReport({ ...baseInput, objective: { issue: 4, manga: 2 } });
    expect(report.objective?.achieved).toBe(true);
    expect(report.objective?.bonus).toBe(SCORING_SCALE.objectiveBonus);
    expect(report.total).toBe(report.readingPoints + report.purchasePenalty + SCORING_SCALE.objectiveBonus);
  });

  it("une seule cible manquée : pas de bonus, mais la progression reste", () => {
    const report = buildGuestReport({ ...baseInput, objective: { issue: 4, omnibus: 1 } });
    expect(report.objective?.achieved).toBe(false);
    expect(report.objective?.bonus).toBe(0);
    expect(report.objective?.progress).toEqual([
      { category: "issue", target: 4, finished: 4 },
      { category: "omnibus", target: 1, finished: 0 },
    ]);
  });

  it("des cibles toutes à 0 valent une absence d'objectif", () => {
    const report = buildGuestReport({ ...baseInput, objective: { issue: 0, manga: 0 } });
    expect(report.objective).toBeNull();
  });

  it("un mois vide donne un score « 0 » propre (jamais −0)", () => {
    const report = buildGuestReport({
      month: "2026-09",
      finishedByCategory: { issue: 0, manga: 0, bd: 0, comics: 0, omnibus: 0, roman: 0 },
      unreadPurchaseCount: 0,
      objective: null,
    });
    expect(report.total).toBe(0);
    expect(Object.is(report.purchasePenalty, -0)).toBe(false);
    expect(deriveShareCardData(report, "Invité").score).toBe("0");
  });

  it("les saisies hostiles sont assainies : négatif, décimal, NaN → 0 ; démesuré → plafonné", () => {
    const report = buildGuestReport({
      ...baseInput,
      finishedByCategory: { issue: -3, manga: 1.5, bd: Number.NaN, comics: 1_000_000, omnibus: 0, roman: 2 },
      unreadPurchaseCount: -1,
    });
    expect(report.finishedByCategory).toEqual({ issue: 0, manga: 0, bd: 0, comics: 999, omnibus: 0, roman: 2 });
    expect(report.unreadPurchaseCount).toBe(0);
    expect(report.purchasePenalty).toBe(0);
  });

  it("les cibles aussi sont assainies : décimale et négative → non visées, démesurée → plafonnée", () => {
    const report = buildGuestReport({
      ...baseInput,
      objective: { issue: 1.5, manga: -2, bd: 1_000_000, roman: 1 },
    });
    expect(report.objective?.progress).toEqual([
      { category: "bd", target: 999, finished: 1 },
      { category: "roman", target: 1, finished: 1 },
    ]);
  });

  it("la chaîne complète : le bilan d'invité se dérive en carte comme un vrai", () => {
    const card = deriveShareCardData(buildGuestReport({ ...baseInput, objective: { issue: 5 } }), "Léna");
    expect(card.name).toBe("LÉNA");
    expect(card.monthLabel).toBe("SEPTEMBRE 2026");
    expect(card.counts).toEqual([4, 2, 1, 3, 0, 1, 2]);
    expect(card.objectives[0]).toEqual({ finished: 4, target: 5, ratio: 4 / 5 });
  });
});
