import { describe, expect, it } from "vitest";
import { computeMonthlyReport } from "./monthly-report";
import { SCORING_SCALE } from "./scale";
import type { BookCategory, PurchaseFact, ReadingFact } from "./types";

/**
 * Chaque règle de calcul des specs §3 a son test, numérotation comprise.
 * Les fabriques gardent les cas lisibles : un test = une situation de lecteur.
 */

let bookCounter = 0;
const nextBookId = () => `book-${++bookCounter}`;

function finished(category: BookCategory, finishedAt: string, overrides: Partial<ReadingFact> = {}): ReadingFact {
  return {
    bookId: nextBookId(),
    category,
    status: "finished",
    startedAt: finishedAt,
    finishedAt,
    ...overrides,
  };
}

function inProgress(category: BookCategory, startedAt: string, overrides: Partial<ReadingFact> = {}): ReadingFact {
  return { bookId: nextBookId(), category, status: "reading", startedAt, finishedAt: null, ...overrides };
}

function abandoned(category: BookCategory, startedAt: string, overrides: Partial<ReadingFact> = {}): ReadingFact {
  return { bookId: nextBookId(), category, status: "abandoned", startedAt, finishedAt: null, ...overrides };
}

function purchase(bookId: string, purchasedAt: string): PurchaseFact {
  return { bookId, purchasedAt };
}

const report = (
  month: string,
  facts: Partial<Parameters<typeof computeMonthlyReport>[1]> = {},
) => computeMonthlyReport(month, { readings: [], purchases: [], ...facts });

describe("le barème (specs §3)", () => {
  it.each([
    ["issue", 0.5],
    ["manga", 1],
    ["bd", 2],
    ["comics", 3],
    ["omnibus", 5],
    ["roman", 5],
  ] as [BookCategory, number][])("une %s terminée rapporte %s point(s)", (category, points) => {
    const result = report("2026-07", { readings: [finished(category, "2026-07-10")] });
    expect(result.readingPoints).toBe(points);
    expect(result.total).toBe(points);
    expect(result.finishedByCategory[category]).toBe(1);
  });

  it("les demi-points s'additionnent exactement (3 issues = 1,5)", () => {
    const result = report("2026-07", {
      readings: [finished("issue", "2026-07-01"), finished("issue", "2026-07-02"), finished("issue", "2026-07-03")],
    });
    expect(result.total).toBe(1.5);
  });
});

describe("règle 1 — les points tombent à la date de FIN", () => {
  it("commencé en mars, terminé en avril : rien en mars, tout en avril", () => {
    const reading = finished("comics", "2026-04-02", { startedAt: "2026-03-15" });
    expect(report("2026-03", { readings: [reading] }).total).toBe(0);
    expect(report("2026-04", { readings: [reading] }).total).toBe(3);
  });

  it("commencer une lecture ne rapporte rien (pas de gonflage en ouvrant dix bouquins)", () => {
    const result = report("2026-07", {
      readings: Array.from({ length: 10 }, () => inProgress("roman", "2026-07-01")),
    });
    expect(result.total).toBe(0);
  });
});

describe("règle 2 — l'abandon", () => {
  it("une lecture abandonnée rapporte 0 point", () => {
    expect(report("2026-07", { readings: [abandoned("manga", "2026-07-01")] }).total).toBe(0);
  });

  it("reprise puis terminée plus tard : points pleins, au mois de la fin", () => {
    // La reprise ne crée pas une nouvelle lecture : c'est la même, redevenue
    // `finished` — le moteur ne voit que l'état courant et la date de fin.
    const comeback = finished("roman", "2026-09-20", { startedAt: "2026-06-01" });
    expect(report("2026-09", { readings: [comeback] }).total).toBe(5);
  });
});

describe("règle 3 — le malus d'achat", () => {
  it("un livre acheté et pas lu : −1 sur le mois de l'achat", () => {
    const result = report("2026-07", { purchases: [purchase("book-x", "2026-07-08")] });
    expect(result.unreadPurchaseCount).toBe(1);
    expect(result.purchasePenalty).toBe(-1);
    expect(result.total).toBe(-1);
  });

  it("acheté puis terminé dans le même mois : malus effacé, points acquis", () => {
    const reading = finished("bd", "2026-07-20");
    const result = report("2026-07", {
      readings: [reading],
      purchases: [purchase(reading.bookId, "2026-07-05")],
    });
    expect(result.unreadPurchaseCount).toBe(0);
    expect(result.total).toBe(2);
  });

  it("acheté en mars, terminé en avril : le −1 de mars reste acquis, les points tombent en avril", () => {
    const reading = finished("manga", "2026-04-10", { startedAt: "2026-03-25" });
    const boughtInMarch = purchase(reading.bookId, "2026-03-12");

    const march = report("2026-03", { readings: [reading], purchases: [boughtInMarch] });
    expect(march.purchasePenalty).toBe(-1);
    expect(march.total).toBe(-1);

    const april = report("2026-04", { readings: [reading], purchases: [boughtInMarch] });
    expect(april.purchasePenalty).toBe(0); // l'achat n'est pas d'avril
    expect(april.total).toBe(1);
  });

  it("racheter un livre déjà lu un mois précédent ne prend pas de malus (il n'entre pas dans la PAL)", () => {
    const readLastYear = finished("roman", "2025-11-30");
    const result = report("2026-07", {
      readings: [readLastYear],
      purchases: [purchase(readLastYear.bookId, "2026-07-14")],
    });
    expect(result.unreadPurchaseCount).toBe(0);
    expect(result.total).toBe(0);
  });

  it("une lecture abandonnée n'annule pas le malus de l'achat", () => {
    // Une lecture lâchée ne sort pas le livre de la pile à lire (§4.5) : seul
    // `finished` efface le malus. Ce test verrouille le filtre sur le statut.
    const reading = abandoned("bd", "2026-07-03");
    const result = report("2026-07", {
      readings: [reading],
      purchases: [purchase(reading.bookId, "2026-07-01")],
    });
    expect(result.unreadPurchaseCount).toBe(1);
    expect(result.total).toBe(-1);
  });

  it("deux achats non lus le même mois : −2", () => {
    const result = report("2026-07", {
      purchases: [purchase("book-a", "2026-07-01"), purchase("book-b", "2026-07-30")],
    });
    expect(result.purchasePenalty).toBe(-2);
  });
});

describe("règle 4 — l'objectif du mois (all-or-nothing)", () => {
  it("toutes les cibles atteintes : +3", () => {
    const result = report("2026-07", {
      readings: [finished("manga", "2026-07-03"), finished("manga", "2026-07-15"), finished("bd", "2026-07-20")],
      objective: { manga: 2, bd: 1 },
    });
    expect(result.objective?.achieved).toBe(true);
    expect(result.objective?.bonus).toBe(3);
    expect(result.total).toBe(1 + 1 + 2 + 3);
  });

  it("une seule cible manquée : 0 bonus, même si le reste déborde", () => {
    const result = report("2026-07", {
      readings: [finished("manga", "2026-07-03"), finished("manga", "2026-07-10"), finished("manga", "2026-07-17")],
      objective: { manga: 2, bd: 1 },
    });
    expect(result.objective?.achieved).toBe(false);
    expect(result.objective?.bonus).toBe(0);
    expect(result.total).toBe(3);
  });

  it("seules les lectures TERMINÉES DANS LE MOIS comptent pour la cible", () => {
    const finishedInJune = finished("bd", "2026-06-28");
    const stillReading = inProgress("bd", "2026-07-02");
    const result = report("2026-07", {
      readings: [finishedInJune, stillReading],
      objective: { bd: 1 },
    });
    expect(result.objective?.achieved).toBe(false);
  });

  it("pas d'objectif déclaré : pas de section objectif, pas de bonus", () => {
    const result = report("2026-07", { readings: [finished("roman", "2026-07-05")] });
    expect(result.objective).toBeNull();
    expect(result.total).toBe(5);
  });

  it("la jauge de progression expose chaque catégorie visée", () => {
    const result = report("2026-07", {
      readings: [finished("issue", "2026-07-01")],
      objective: { issue: 2 },
    });
    expect(result.objective?.progress).toEqual([{ category: "issue", target: 2, finished: 1 }]);
  });
});

describe("règle 5 — le score du mois est la somme du bilan", () => {
  it("lectures + malus + bonus, sur un mois réaliste", () => {
    // Le mois type : 2 mangas + 1 comics terminés, objectif « 2 mangas » atteint,
    // 3 achats dont 1 terminé dans le mois → malus −2.
    const boughtAndRead = finished("comics", "2026-07-25");
    const result = report("2026-07", {
      readings: [finished("manga", "2026-07-04"), finished("manga", "2026-07-18"), boughtAndRead],
      purchases: [
        purchase(boughtAndRead.bookId, "2026-07-02"),
        purchase("book-unread-1", "2026-07-09"),
        purchase("book-unread-2", "2026-07-16"),
      ],
      objective: { manga: 2 },
    });
    expect(result.readingPoints).toBe(1 + 1 + 3);
    expect(result.purchasePenalty).toBe(-2);
    expect(result.objective?.bonus).toBe(3);
    expect(result.total).toBe(5 - 2 + 3);
  });

  it("un mois vide rend un bilan à zéro, toutes catégories présentes", () => {
    const result = report("2026-07");
    expect(result.total).toBe(0);
    expect(Object.values(result.finishedByCategory)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe("règle 6 — le score est un décimal exact", () => {
  it("0,5 + 0,5 + 0,5 − 1 = 0,5 tout rond (pas de dérive flottante)", () => {
    const result = report("2026-07", {
      readings: [finished("issue", "2026-07-01"), finished("issue", "2026-07-02"), finished("issue", "2026-07-03")],
      purchases: [purchase("book-x", "2026-07-04")],
    });
    expect(result.total).toBe(0.5);
  });
});

describe("les relectures (specs §4.2)", () => {
  it("relire un bouquin re-rapporte ses points : deux lectures du même book_id comptent deux fois", () => {
    const bookId = "book-reread";
    const result = report("2026-07", {
      readings: [
        finished("manga", "2026-07-05", { bookId }),
        finished("manga", "2026-07-28", { bookId }),
      ],
    });
    expect(result.finishedByCategory.manga).toBe(2);
    expect(result.total).toBe(2);
  });
});

describe("le barème vit dans la constante unique", () => {
  it("le moteur reflète SCORING_SCALE, pas des valeurs recopiées", () => {
    // Garde-fou : si le barème change dans scale.ts, ce test continue de passer
    // sans retouche — c'est le contrat « une constante unique ».
    const result = report("2026-07", {
      readings: [finished("omnibus", "2026-07-10")],
      purchases: [purchase("book-x", "2026-07-11")],
      objective: { omnibus: 1 },
    });
    expect(result.total).toBe(
      SCORING_SCALE.pointsByCategory.omnibus + SCORING_SCALE.unreadPurchasePenalty + SCORING_SCALE.objectiveBonus,
    );
  });
});
