import { describe, expect, it } from "vitest";
import { computeMonthlyReport } from "./monthly-report";
import { formatPoints, formatPointsLabel, reportToText } from "./report-text";
import type { BookCategory, ReadingFact } from "./types";

/**
 * Le texte copiable pour l'antenne — la sortie du bouton du livrable (§4.5).
 * Les bilans passent par le VRAI moteur : le test verrouille le rendu texte,
 * pas une re-simulation des règles de calcul.
 */

let bookCounter = 0;
const nextBookId = () => `book-${++bookCounter}`;

function finished(category: BookCategory, finishedAt: string): ReadingFact {
  return { bookId: nextBookId(), category, status: "finished", startedAt: finishedAt, finishedAt };
}

const report = (
  month: string,
  facts: Partial<Parameters<typeof computeMonthlyReport>[1]> = {},
) => computeMonthlyReport(month, { readings: [], purchases: [], ...facts });

describe("formatPoints — la virgule française et le signe", () => {
  it.each([
    [7.5, "+7,5"],
    [3, "+3"],
    [-2, "−2"],
    [-0.5, "−0,5"],
    [0, "0"],
  ])("%s → %s", (points, expected) => {
    expect(formatPoints(points)).toBe(expected);
  });
});

describe("formatPointsLabel — le point signé + l'unité accordée (toast #73)", () => {
  it.each([
    [0.5, "+0,5 pt"], // une issue au barème
    [1, "+1 pt"], // un manga
    [2, "+2 pts"], // une BD
    [3, "+3 pts"], // un comics
    [5, "+5 pts"], // un roman / omnibus
    [-1, "−1 pt"], // un achat non lu
  ])("%s → %s", (points, expected) => {
    expect(formatPointsLabel(points)).toBe(expected);
  });
});

describe("reportToText", () => {
  it("un bilan nominal complet : une ligne par catégorie lue, les achats, le total", () => {
    const result = reportToText(
      report("2026-07", {
        readings: [finished("manga", "2026-07-04"), finished("manga", "2026-07-18"), finished("comics", "2026-07-25")],
        purchases: [
          { bookId: "book-unread-1", purchasedAt: "2026-07-09" },
          { bookId: "book-unread-2", purchasedAt: "2026-07-16" },
        ],
      }),
    );
    expect(result).toBe(
      [
        "Objectif PAL — bilan de juillet 2026",
        "Manga : 2 (+2)",
        "Comics : 1 (+3)",
        "Achats non lus : 2 (−2)",
        "Score du mois : +3",
      ].join("\n"),
    );
  });

  it("un bilan vide le dit explicitement, sans ligne de catégorie fantôme", () => {
    const result = reportToText(report("2026-02"));
    expect(result).toBe(
      [
        "Objectif PAL — bilan de février 2026",
        "Aucune lecture terminée ce mois-ci.",
        "Achats non lus : 0 (0)",
        "Score du mois : 0",
      ].join("\n"),
    );
  });

  it("les demi-points s'écrivent avec la virgule (5 issues = +2,5)", () => {
    const result = reportToText(
      report("2026-07", {
        readings: Array.from({ length: 5 }, (_, index) => finished("issue", `2026-07-0${index + 1}`)),
      }),
    );
    expect(result).toContain("Issue : 5 (+2,5)");
    expect(result).toContain("Score du mois : +2,5");
  });

  it("l'objectif atteint affiche son bonus, l'objectif manqué le dit", () => {
    const achieved = reportToText(
      report("2026-07", { readings: [finished("bd", "2026-07-10")], objective: { bd: 1 } }),
    );
    expect(achieved).toContain("Objectif du mois : atteint (+3)");
    expect(achieved).toContain("Score du mois : +5");

    const missed = reportToText(report("2026-07", { objective: { bd: 1 } }));
    expect(missed).toContain("Objectif du mois : manqué");
  });

  it("sans objectif déclaré, la ligne objectif n'existe pas", () => {
    expect(reportToText(report("2026-07"))).not.toContain("Objectif du mois");
  });
});

describe("les distinctions du mois dans le texte (décision du 18/07/2026)", () => {
  it("s'ajoutent après le score, avec leur commentaire éventuel", () => {
    const result = reportToText(report("2026-07", { readings: [finished("bd", "2026-07-10")] }), [
      { kind: "favorite", title: "Monster T3", comment: "le retournement du chapitre 5" },
      { kind: "bad_surprise", title: "Un album décevant", comment: null },
    ]);
    expect(result.split("\n").slice(-3)).toEqual([
      "Score du mois : +2",
      "L'œuvre préférée du mois : Monster T3 — le retournement du chapitre 5",
      "La mauvaise surprise : Un album décevant",
    ]);
  });

  it("sans distinction, le texte s'arrête au score — inchangé", () => {
    expect(reportToText(report("2026-07")).split("\n").at(-1)).toBe("Score du mois : 0");
  });
});
