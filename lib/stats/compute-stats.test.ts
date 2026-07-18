import { describe, expect, it } from "vitest";
import { derivePal, type PalBookRecord } from "@/lib/pal/derive-pal";
import { computeStats, type StatBookRecord } from "./compute-stats";

/**
 * Les stats doivent raconter la même histoire que le bilan et la PAL (§4.5) :
 * chaque règle a son test, y compris la cohérence pile ↔ `derivePal`. Les
 * fabriques gardent les cas lisibles : un test = une situation de lecteur.
 */

const CURRENT_MONTH = "2026-07";

let bookCounter = 0;

function book(overrides: Partial<StatBookRecord> = {}): StatBookRecord {
  bookCounter += 1;
  return {
    id: `book-${bookCounter}`,
    category: "bd",
    publisher: null,
    seriesName: null,
    pageCount: null,
    deletedAt: null,
    purchases: [],
    readings: [],
    ...overrides,
  };
}

function bought(purchasedAt: string) {
  return { purchasedAt, deletedAt: null };
}

function finished(finishedAt: string, overrides: Partial<StatBookRecord["readings"][number]> = {}) {
  return {
    status: "finished" as const,
    startedAt: finishedAt,
    finishedAt,
    rating: null,
    deletedAt: null,
    ...overrides,
  };
}

/** Le même livre, dans la forme que consomme `derivePal` — pour le test de cohérence. */
function toPalRecord(record: StatBookRecord, index: number): PalBookRecord {
  return {
    id: record.id,
    title: `Livre ${record.id}`,
    series_name: record.seriesName,
    issue_number: null,
    category: record.category as PalBookRecord["category"],
    cover_url: null,
    deleted_at: record.deletedAt,
    purchases: record.purchases.map((purchase, purchaseIndex) => ({
      id: `purchase-${index}-${purchaseIndex}`,
      purchased_at: purchase.purchasedAt,
      deleted_at: purchase.deletedAt,
    })),
    readings: record.readings.map((reading) => ({
      status: reading.status,
      finished_at: reading.finishedAt,
      deleted_at: reading.deletedAt,
    })),
  };
}

describe("le volume", () => {
  it("mois, année, total : des fins réparties sur plusieurs mois et années", () => {
    const result = computeStats(
      [
        book({ readings: [finished("2026-07-05"), finished("2026-03-10")] }),
        book({ readings: [finished("2025-11-20")] }),
      ],
      CURRENT_MONTH,
    );
    expect(result.volume.finishedThisMonth).toBe(1);
    expect(result.volume.finishedThisYear).toBe(2);
    expect(result.volume.finishedTotal).toBe(3);
  });

  it("par catégorie : les six clés sont présentes, 0 compris", () => {
    const result = computeStats(
      [
        book({ category: "manga", readings: [finished("2026-07-01")] }),
        book({ category: "manga", readings: [finished("2026-07-02")] }),
        book({ category: "omnibus", readings: [finished("2026-05-20")] }),
        book({ category: "roman", readings: [finished("2026-06-15")] }),
      ],
      CURRENT_MONTH,
    );
    expect(result.volume.finishedByCategory).toEqual({
      issue: 0,
      manga: 2,
      bd: 0,
      comics: 0,
      omnibus: 1,
      roman: 1,
    });
  });

  it("une relecture compte deux fois dans le volume — chaque lecture est un fait", () => {
    const result = computeStats(
      [book({ readings: [finished("2026-05-10"), finished("2026-07-02")] })],
      CURRENT_MONTH,
    );
    expect(result.volume.finishedTotal).toBe(2);
    expect(result.volume.finishedThisMonth).toBe(1);
  });

  it("en cours ou abandonnée : aucune influence sur le volume", () => {
    const result = computeStats(
      [
        book({
          readings: [
            { status: "reading", startedAt: "2026-07-01", finishedAt: null, rating: null, deletedAt: null },
            { status: "abandoned", startedAt: "2026-06-01", finishedAt: null, rating: 1, deletedAt: null },
          ],
        }),
      ],
      CURRENT_MONTH,
    );
    expect(result.volume.finishedTotal).toBe(0);
  });
});

describe("les pages", () => {
  it("somme les pageCount connus et compte les inconnus à part", () => {
    const result = computeStats(
      [
        book({ pageCount: 200, readings: [finished("2026-07-01")] }),
        book({ pageCount: 48, readings: [finished("2026-07-02")] }),
        book({ pageCount: null, readings: [finished("2026-07-03")] }),
      ],
      CURRENT_MONTH,
    );
    expect(result.volume.pagesRead).toBe(248);
    expect(result.volume.booksWithoutPageCount).toBe(1);
  });

  it("une relecture re-compte les pages — cohérent avec le volume par lecture", () => {
    const result = computeStats(
      [book({ pageCount: 100, readings: [finished("2026-06-01"), finished("2026-07-01")] })],
      CURRENT_MONTH,
    );
    expect(result.volume.pagesRead).toBe(200);
  });
});

describe("la répartition par éditeur", () => {
  it("trie par nombre décroissant puis nom croissant à égalité", () => {
    const result = computeStats(
      [
        book({ publisher: "Urban", readings: [finished("2026-07-01")] }),
        book({ publisher: "Glénat", readings: [finished("2026-07-02")] }),
        book({ publisher: "Urban", readings: [finished("2026-07-03")] }),
        book({ publisher: "Dargaud", readings: [finished("2026-07-04")] }),
      ],
      CURRENT_MONTH,
    );
    expect(result.breakdown.byPublisher).toEqual([
      { publisher: "Urban", count: 2 },
      { publisher: "Dargaud", count: 1 },
      { publisher: "Glénat", count: 1 },
    ]);
  });

  it("un éditeur null est exclu (0 % nul mesuré) — pas de ligne fantôme", () => {
    const result = computeStats([book({ publisher: null, readings: [finished("2026-07-01")] })], CURRENT_MONTH);
    expect(result.breakdown.byPublisher).toEqual([]);
  });

  it("byCategory ré-expose le même décompte que le volume", () => {
    const result = computeStats([book({ category: "comics", readings: [finished("2026-07-01")] })], CURRENT_MONTH);
    expect(result.breakdown.byCategory).toEqual(result.volume.finishedByCategory);
  });
});

describe("les notes", () => {
  it("moyennes globale, du mois, de l'année et par catégorie", () => {
    const result = computeStats(
      [
        book({ category: "manga", readings: [finished("2026-07-01", { rating: 5 })] }),
        book({ category: "manga", readings: [finished("2026-02-01", { rating: 3 })] }),
        book({ category: "bd", readings: [finished("2025-12-01", { rating: 1 })] }),
      ],
      CURRENT_MONTH,
    );
    expect(result.ratings.averageOverall).toBe(3);
    expect(result.ratings.averageThisMonth).toBe(5);
    expect(result.ratings.averageThisYear).toBe(4);
    expect(result.ratings.averageByCategory.manga).toBe(4);
    expect(result.ratings.averageByCategory.bd).toBe(1);
  });

  it("les lectures non notées sont hors du dénominateur", () => {
    const result = computeStats(
      [book({ readings: [finished("2026-07-01", { rating: 4 }), finished("2026-07-02")] })],
      CURRENT_MONTH,
    );
    expect(result.ratings.averageOverall).toBe(4);
  });

  it("aucune note : null partout, jamais NaN ni 0", () => {
    const result = computeStats([book({ readings: [finished("2026-07-01")] })], CURRENT_MONTH);
    expect(result.ratings.averageOverall).toBeNull();
    expect(result.ratings.averageThisMonth).toBeNull();
    expect(result.ratings.averageThisYear).toBeNull();
    expect(result.ratings.averageByCategory.bd).toBeNull();
  });

  it("les demi-étoiles restent exactes (2,5 + 3,5 → 3)", () => {
    const result = computeStats(
      [
        book({ readings: [finished("2026-07-01", { rating: 2.5 })] }),
        book({ readings: [finished("2026-07-02", { rating: 3.5 })] }),
      ],
      CURRENT_MONTH,
    );
    expect(result.ratings.averageOverall).toBe(3);
  });
});

describe("la santé de la PAL", () => {
  it("solde du mois : entrées − sorties", () => {
    const result = computeStats(
      [
        book({ purchases: [bought("2026-07-03")] }),
        book({ purchases: [bought("2026-07-05")] }),
        book({ purchases: [bought("2026-06-01")], readings: [finished("2026-07-10")] }),
      ],
      CURRENT_MONTH,
    );
    expect(result.pal.monthEntries).toBe(2);
    expect(result.pal.monthExits).toBe(1);
    expect(result.pal.monthBalance).toBe(1);
  });

  it("la courbe cumule mois par mois, uniquement les mois à mouvement", () => {
    const result = computeStats(
      [
        book({ purchases: [bought("2026-03-01")] }),
        book({ purchases: [bought("2026-03-15")], readings: [finished("2026-06-10")] }),
        book({ purchases: [bought("2026-07-02")] }),
      ],
      CURRENT_MONTH,
    );
    // Avril et mai sans mouvement : pas de trous générés.
    expect(result.pal.cumulativeByMonth).toEqual([
      { month: "2026-03", size: 2 },
      { month: "2026-06", size: 1 },
      { month: "2026-07", size: 2 },
    ]);
  });

  it("un emprunt terminé compte hors PAL, par lecture — la relecture aussi", () => {
    const result = computeStats(
      [book({ readings: [finished("2026-06-10"), finished("2026-07-01")] })],
      CURRENT_MONTH,
    );
    expect(result.pal.readOutsidePalCount).toBe(2);
    expect(result.pal.currentSize).toBe(0);
    expect(result.pal.cumulativeByMonth).toEqual([]);
  });

  it("une relecture ne re-vide pas la pile : une seule sortie par livre", () => {
    const result = computeStats(
      [book({ purchases: [bought("2026-05-01")], readings: [finished("2026-05-10"), finished("2026-07-02")] })],
      CURRENT_MONTH,
    );
    expect(result.pal.monthExits).toBe(0);
    expect(result.pal.currentSize).toBe(0);
  });

  it("racheter un déjà-lu (§3.3) : aucune entrée, aucune sortie", () => {
    const result = computeStats(
      [book({ purchases: [bought("2026-07-05")], readings: [finished("2026-06-12")] })],
      CURRENT_MONTH,
    );
    expect(result.pal.monthEntries).toBe(0);
    expect(result.pal.cumulativeByMonth).toEqual([]);
    // Possédé (même après coup) : cette lecture n'est pas un emprunt.
    expect(result.pal.readOutsidePalCount).toBe(0);
  });

  it("cohérence obligatoire : currentSize === derivePal(mêmes données).entries.length", () => {
    const records = [
      book({ purchases: [bought("2026-01-05")] }),
      book({ purchases: [bought("2026-02-01")], readings: [finished("2026-03-10")] }),
      book({ purchases: [bought("2026-04-01"), bought("2026-04-20")] }),
      book({ purchases: [bought("2026-05-05")], readings: [finished("2026-05-01")] }),
      book({ readings: [finished("2026-06-01")] }),
      book({ purchases: [bought("2026-06-15")], readings: [finished("2026-06-20"), finished("2026-07-01")] }),
    ];
    const stats = computeStats(records, CURRENT_MONTH);
    const pal = derivePal(records.map(toPalRecord));
    expect(stats.pal.currentSize).toBe(pal.entries.length);
    // Et le dernier point de la courbe EST la taille à date.
    expect(stats.pal.cumulativeByMonth.at(-1)?.size).toBe(stats.pal.currentSize);
  });
});

describe("la suppression douce", () => {
  it("un livre soft-deleted est exclu de tout, achats et lectures compris", () => {
    const result = computeStats(
      [
        book({
          deletedAt: "2026-07-01T10:00:00Z",
          publisher: "Urban",
          purchases: [bought("2026-06-01")],
          readings: [finished("2026-06-20", { rating: 5 })],
        }),
      ],
      CURRENT_MONTH,
    );
    expect(result.volume.finishedTotal).toBe(0);
    expect(result.pal.cumulativeByMonth).toEqual([]);
    expect(result.ratings.averageOverall).toBeNull();
  });

  it("un achat soft-deleted ne possède pas : la lecture devient un emprunt", () => {
    const result = computeStats(
      [book({ purchases: [{ purchasedAt: "2026-06-01", deletedAt: "2026-06-02T09:00:00Z" }], readings: [finished("2026-07-01")] })],
      CURRENT_MONTH,
    );
    expect(result.pal.readOutsidePalCount).toBe(1);
    expect(result.pal.currentSize).toBe(0);
  });

  it("une lecture soft-deleted ne compte nulle part et ne vide pas la pile", () => {
    const result = computeStats(
      [
        book({
          purchases: [bought("2026-06-01")],
          readings: [finished("2026-07-01", { rating: 5, deletedAt: "2026-07-02T08:00:00Z" })],
        }),
      ],
      CURRENT_MONTH,
    );
    expect(result.volume.finishedTotal).toBe(0);
    expect(result.ratings.averageOverall).toBeNull();
    expect(result.pal.currentSize).toBe(1);
  });
});

describe("le cas vide", () => {
  it("aucune donnée : des zéros, des null de note, aucun crash", () => {
    const result = computeStats([], CURRENT_MONTH);
    expect(result.volume.finishedTotal).toBe(0);
    expect(result.volume.finishedByCategory.bd).toBe(0);
    expect(result.pal.currentSize).toBe(0);
    expect(result.pal.monthBalance).toBe(0);
    expect(result.pal.cumulativeByMonth).toEqual([]);
    expect(result.breakdown.byPublisher).toEqual([]);
    expect(result.ratings.averageOverall).toBeNull();
  });
});
