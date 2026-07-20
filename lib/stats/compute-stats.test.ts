import { describe, expect, it } from "vitest";
import { derivePal, type PalBookRecord } from "@/lib/pal/derive-pal";
import {
  computeStats,
  MIN_RATED_READINGS_TO_RANK,
  STALLED_READING_DAYS,
  type StatBookRecord,
} from "./compute-stats";
import type { SeriesCatalog } from "./series-catalog";

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
    title: `Livre ${bookCounter}`,
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

/** « Je possède » (#101) — sans date par défaut : l'étagère d'avant l'app. */
function owns(overrides: { ownedSince?: string | null; disposedAt?: string | null } = {}) {
  return {
    ownedSince: overrides.ownedSince ?? null,
    disposedAt: overrides.disposedAt ?? null,
    deletedAt: null,
  };
}

/** « Je l'ai déjà lu », sans savoir quand (#101) : terminée, aucune date. */
function finishedUndated(overrides: Partial<StatBookRecord["readings"][number]> = {}) {
  return {
    status: "finished" as const,
    startedAt: null,
    finishedAt: null,
    rating: null,
    deletedAt: null,
    ...overrides,
  };
}

/** Le même livre, dans la forme que consomme `derivePal` — pour le test de cohérence. */
function toPalRecord(record: StatBookRecord, index: number): PalBookRecord {
  return {
    id: record.id,
    title: record.title,
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
    ownerships: (record.ownerships ?? []).map((ownership, ownershipIndex) => ({
      id: `ownership-${index}-${ownershipIndex}`,
      owned_since: ownership.ownedSince,
      disposed_at: ownership.disposedAt,
      deleted_at: ownership.deletedAt,
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
      // Les quatre situations de #101, mêlées aux achats : la cohérence doit
      // tenir avec du non-daté dans le lot, sinon le mécanisme ne sert à rien.
      book({ ownerships: [owns()] }),
      book({ ownerships: [owns({ ownedSince: "2024-03-15" })] }),
      book({ ownerships: [owns()], readings: [finishedUndated()] }),
      book({ ownerships: [owns({ ownedSince: "2025-01-10", disposedAt: "2026-02-02" })] }),
    ];
    const stats = computeStats(records, CURRENT_MONTH);
    const pal = derivePal(records.map(toPalRecord));
    expect(stats.pal.currentSize).toBe(pal.entries.length);
    // Et le dernier point de la courbe EST la taille à date.
    expect(stats.pal.cumulativeByMonth.at(-1)?.size).toBe(stats.pal.currentSize);
  });
});

describe("la PAL avec des mouvements sans date (#101)", () => {
  it("l'étagère scannée : la pile grossit, aucun mois ne bouge, la courbe reste vide", () => {
    const shelf = Array.from({ length: 12 }, () => book({ ownerships: [owns()] }));
    const result = computeStats(shelf, CURRENT_MONTH);
    expect(result.pal.currentSize).toBe(12);
    expect(result.pal.monthEntries).toBe(0);
    expect(result.pal.monthBalance).toBe(0);
    // Aucun mois n'a de mouvement : il n'y a rien à tracer.
    expect(result.pal.cumulativeByMonth).toEqual([]);
  });

  it("LIGNE DE BASE : les non-datés décalent la courbe, qui finit sur la vraie pile", () => {
    // 3 livres de l'étagère (sans date) + 1 acheté en juillet : la courbe ne
    // doit pas démarrer à 1 en juillet, sinon elle raconte une pile de 1 alors
    // qu'il y en a 4 — et le dernier point mentirait sur le stock réel.
    const result = computeStats(
      [
        book({ ownerships: [owns()] }),
        book({ ownerships: [owns()] }),
        book({ ownerships: [owns()] }),
        book({ purchases: [bought("2026-07-03")] }),
      ],
      CURRENT_MONTH,
    );
    expect(result.pal.currentSize).toBe(4);
    expect(result.pal.cumulativeByMonth).toEqual([{ month: "2026-07", size: 4 }]);
    expect(result.pal.cumulativeByMonth.at(-1)?.size).toBe(result.pal.currentSize);
  });

  it("l'invariant tient aussi quand une sortie n'est pas datée", () => {
    const result = computeStats(
      [
        book({ ownerships: [owns()] }),
        book({ purchases: [bought("2026-07-03")], readings: [finishedUndated()] }),
      ],
      CURRENT_MONTH,
    );
    expect(result.pal.currentSize).toBe(1);
    expect(result.pal.cumulativeByMonth.at(-1)?.size).toBe(result.pal.currentSize);
  });

  it("un livre possédé (déclaré) et lu n'est PAS un emprunt", () => {
    const result = computeStats([book({ ownerships: [owns()], readings: [finished("2026-07-05")] })], CURRENT_MONTH);
    expect(result.pal.readOutsidePalCount).toBe(0);
  });
});

describe("les lectures sans date de fin — « déjà lu » (#101)", () => {
  it("comptent dans le volume TOTAL, dans aucun mois ni aucune année", () => {
    // C'est un fait de lecture : il compte. Mais il n'appartient à aucune
    // période — lui en inventer une fausserait le bilan et les courbes.
    const result = computeStats([book({ readings: [finishedUndated()] })], CURRENT_MONTH);
    expect(result.volume.finishedTotal).toBe(1);
    expect(result.volume.finishedThisMonth).toBe(0);
    expect(result.volume.finishedThisYear).toBe(0);
  });

  it("n'apparaissent dans aucun mois du volume temporel", () => {
    const result = computeStats(
      [book({ readings: [finishedUndated()] }), book({ readings: [finished("2026-07-05")] })],
      CURRENT_MONTH,
    );
    expect(result.monthly.finishedByMonth).toEqual([{ month: "2026-07", count: 1 }]);
  });

  it("ne fabriquent pas une durée de lecture de zéro jour", () => {
    const result = computeStats([book({ readings: [finishedUndated()] })], CURRENT_MONTH);
    expect(result.rythme.averageDurationDays).toBeNull();
    expect(result.rythme.readingsWithoutDuration).toBe(1);
  });

  it("leur NOTE pèse dans les moyennes (la note est un fait, pas une date)", () => {
    const result = computeStats([book({ readings: [finishedUndated({ rating: 4 })] })], CURRENT_MONTH);
    expect(result.ratings.averageOverall).toBe(4);
    // …mais pas dans les moyennes DATÉES : la lecture n'a ni mois ni année.
    expect(result.ratings.averageThisMonth).toBeNull();
    expect(result.ratings.averageThisYear).toBeNull();
  });

  it("restent hors du CLASSEMENT, qui affiche une date de lecture", () => {
    const rated = Array.from({ length: MIN_RATED_READINGS_TO_RANK }, () =>
      book({ publisher: "Glénat", readings: [finished("2026-07-05", { rating: 5 })] }),
    );
    const result = computeStats(
      [...rated, book({ publisher: "Glénat", readings: [finishedUndated({ rating: 1 })] })],
      CURRENT_MONTH,
    );
    expect(result.tastes.ranking).toHaveLength(MIN_RATED_READINGS_TO_RANK);
    // La note non datée pèse quand même dans la moyenne de l'éditeur.
    const glenat = result.tastes.publishers.find((group) => group.name === "Glénat");
    expect(glenat?.ratedCount).toBe(MIN_RATED_READINGS_TO_RANK + 1);
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

/* ------------------------------------------------------------------ *
 * Les analyses avancées (#30) — lots A, B, C, D.
 * ------------------------------------------------------------------ */

const TODAY = "2026-07-19";

/** Une lecture en cours, commencée à la date donnée. */
function inProgress(startedAt: string) {
  return { status: "reading" as const, startedAt, finishedAt: null, rating: null, deletedAt: null };
}

/** Une lecture terminée, avec un début distinct de sa fin (pour les durées). */
function read(startedAt: string, finishedAt: string, rating: number | null = null) {
  return { status: "finished" as const, startedAt, finishedAt, rating, deletedAt: null };
}

let eventCounter = 0;
function event(status: "reading" | "finished" | "abandoned", occurredAt: string, readingId = "reading-1") {
  eventCounter += 1;
  return { id: eventCounter, readingId, status, occurredAt: `${occurredAt}T10:00:00+00:00` };
}

describe("lot A — le rythme : durée d'une lecture", () => {
  it("moyenne globale et par catégorie sur les lectures datées", () => {
    const result = computeStats(
      [
        book({ category: "bd", readings: [read("2026-07-01", "2026-07-05")] }), // 4 jours
        book({ category: "bd", readings: [read("2026-07-01", "2026-07-11")] }), // 10 jours
        book({ category: "roman", readings: [read("2026-06-01", "2026-06-21")] }), // 20 jours
      ],
      CURRENT_MONTH,
    );
    expect(result.rythme.averageDurationDays).toBeCloseTo((4 + 10 + 20) / 3);
    expect(result.rythme.averageDurationByCategory.bd).toBeCloseTo(7);
    expect(result.rythme.averageDurationByCategory.roman).toBeCloseTo(20);
    expect(result.rythme.averageDurationByCategory.manga).toBeNull();
    expect(result.rythme.readingsWithoutDuration).toBe(0);
  });

  it("une lecture du jour dure zéro jour — et compte quand même", () => {
    const result = computeStats([book({ readings: [read("2026-07-05", "2026-07-05")] })], CURRENT_MONTH);
    expect(result.rythme.averageDurationDays).toBe(0);
    expect(result.rythme.readingsWithoutDuration).toBe(0);
  });

  it("une fin ANTÉRIEURE au début est incohérente : elle ne fabrique pas une durée négative", () => {
    const result = computeStats([book({ readings: [read("2026-07-10", "2026-07-01")] })], CURRENT_MONTH);
    expect(result.rythme.averageDurationDays).toBeNull();
    expect(result.rythme.readingsWithoutDuration).toBe(1);
  });

  it("aucune lecture datée : `null`, jamais NaN ni zéro", () => {
    const result = computeStats([], CURRENT_MONTH);
    expect(result.rythme.averageDurationDays).toBeNull();
    expect(result.rythme.readingsWithoutDuration).toBe(0);
  });

  it("la durée traverse un changement de mois et une année bissextile", () => {
    const result = computeStats([book({ readings: [read("2024-02-27", "2024-03-01")] })], CURRENT_MONTH);
    expect(result.rythme.averageDurationDays).toBe(3); // 27 → 29 février → 1er mars
  });
});

describe("lot A — les lectures qui traînent", () => {
  it("au-delà du seuil elle est listée, à la limite exacte elle ne l'est pas", () => {
    const result = computeStats(
      [
        book({ title: "Ça traîne", readings: [inProgress("2026-01-01")] }),
        // Exactement 60 jours avant `TODAY` : le seuil est STRICT.
        book({ title: "Pile au seuil", readings: [inProgress("2026-05-20")] }),
        book({ title: "Commencée hier", readings: [inProgress("2026-07-18")] }),
      ],
      CURRENT_MONTH,
      { today: TODAY },
    );
    expect(result.rythme.stalledReadings.map((reading) => reading.title)).toEqual(["Ça traîne"]);
    expect(result.rythme.stalledReadings[0].daysSinceStart).toBe(199);
    expect(STALLED_READING_DAYS).toBe(60);
  });

  it("la plus ancienne d'abord", () => {
    const result = computeStats(
      [
        book({ title: "Depuis un an", readings: [inProgress("2025-07-01")] }),
        book({ title: "Depuis trois mois", readings: [inProgress("2026-04-01")] }),
      ],
      CURRENT_MONTH,
      { today: TODAY },
    );
    expect(result.rythme.stalledReadings.map((reading) => reading.title)).toEqual([
      "Depuis un an",
      "Depuis trois mois",
    ]);
  });

  it("ni les terminées, ni les abandonnées, ni les supprimées ne traînent", () => {
    const result = computeStats(
      [
        book({ readings: [read("2025-01-01", "2026-07-01")] }),
        book({ readings: [{ ...inProgress("2025-01-01"), status: "abandoned" as const }] }),
        book({ readings: [{ ...inProgress("2025-01-01"), deletedAt: "2026-07-01" }] }),
      ],
      CURRENT_MONTH,
      { today: TODAY },
    );
    expect(result.rythme.stalledReadings).toEqual([]);
  });

  it("sans date du jour, la liste reste vide plutôt que de mentir", () => {
    const result = computeStats([book({ readings: [inProgress("2020-01-01")] })], CURRENT_MONTH);
    expect(result.rythme.stalledReadings).toEqual([]);
  });

  it("un livre supprimé en douceur ne traîne pas non plus", () => {
    const result = computeStats([book({ deletedAt: "2026-07-01", readings: [inProgress("2020-01-01")] })], CURRENT_MONTH, {
      today: TODAY,
    });
    expect(result.rythme.stalledReadings).toEqual([]);
  });
});

describe("lot A — abandons & reprises par mois", () => {
  it("consomme le journal d'états et range chaque événement dans son mois", () => {
    const result = computeStats([], CURRENT_MONTH, {
      readingEvents: [
        event("reading", "2026-05-02", "r1"), // un début, jamais une reprise
        event("abandoned", "2026-05-20", "r1"),
        event("reading", "2026-06-01", "r1"), // reprise
        event("abandoned", "2026-06-10", "r2"),
        event("reading", "2026-06-11", "r2"), // reprise (r2 vue lors de son abandon)
      ],
      today: TODAY,
    });
    expect(result.rythme.eventsByMonth).toEqual([
      { month: "2026-05", abandons: 1, resumptions: 0 },
      { month: "2026-06", abandons: 1, resumptions: 2 },
    ]);
  });

  it("sans journal fourni, aucun mois — pas de zéro inventé", () => {
    const result = computeStats([book({ readings: [finished("2026-07-01")] })], CURRENT_MONTH);
    expect(result.rythme.eventsByMonth).toEqual([]);
  });
});

describe("lot B — la répartition par série", () => {
  it("compte les TOMES lus (des livres), pas les lectures : une relecture ne double pas", () => {
    const result = computeStats(
      [
        book({ seriesName: "Blacksad", readings: [finished("2026-07-01"), finished("2026-07-10")] }),
        book({ seriesName: "Blacksad", readings: [finished("2026-07-02")] }),
        book({ seriesName: "Berserk", readings: [finished("2026-07-03")] }),
      ],
      CURRENT_MONTH,
    );
    expect(result.series.volumesRead).toEqual([
      { seriesName: "Blacksad", count: 2 },
      { seriesName: "Berserk", count: 1 },
    ]);
  });

  it("un tome acheté mais pas lu ne compte pas, un livre hors série non plus", () => {
    const result = computeStats(
      [
        book({ seriesName: "Blacksad", purchases: [bought("2026-07-01")] }),
        book({ seriesName: null, readings: [finished("2026-07-01")] }),
      ],
      CURRENT_MONTH,
    );
    expect(result.series.volumesRead).toEqual([]);
  });

  it("à égalité de tomes, l'ordre alphabétique tranche", () => {
    const result = computeStats(
      [
        book({ seriesName: "Zorro", readings: [finished("2026-07-01")] }),
        book({ seriesName: "Astérix", readings: [finished("2026-07-01")] }),
      ],
      CURRENT_MONTH,
    );
    expect(result.series.volumesRead.map((entry) => entry.seriesName)).toEqual(["Astérix", "Zorro"]);
  });
});

describe("lot C — les goûts avancés", () => {
  /** Trois lectures notées d'une même série — le minimum pour être classée. */
  const ratedSeries = (seriesName: string, publisher: string, ratings: number[]) =>
    ratings.map((rating, index) =>
      book({
        seriesName,
        publisher,
        readings: [finished(`2026-07-0${index + 1}`, { rating })],
      }),
    );

  it("sous le seuil de volume, rien n'est classé", () => {
    const result = computeStats(ratedSeries("Blacksad", "Dargaud", [5, 5]), CURRENT_MONTH);
    expect(MIN_RATED_READINGS_TO_RANK).toBe(3);
    expect(result.tastes.series).toEqual([]);
    expect(result.tastes.publishers).toEqual([]);
  });

  it("au seuil, la série et l'éditeur entrent au classement, moyenne en tête", () => {
    const result = computeStats(
      [...ratedSeries("Blacksad", "Dargaud", [4, 5, 3]), ...ratedSeries("Berserk", "Glénat", [2, 1, 3])],
      CURRENT_MONTH,
    );
    expect(result.tastes.series).toEqual([
      { name: "Blacksad", average: 4, ratedCount: 3 },
      { name: "Berserk", average: 2, ratedCount: 3 },
    ]);
    expect(result.tastes.publishers.map((group) => group.name)).toEqual(["Dargaud", "Glénat"]);
  });

  it("les lectures NON notées ne comptent pas dans le seuil", () => {
    const result = computeStats(
      [
        ...ratedSeries("Blacksad", "Dargaud", [5, 5]),
        book({ seriesName: "Blacksad", publisher: "Dargaud", readings: [finished("2026-07-09")] }),
      ],
      CURRENT_MONTH,
    );
    expect(result.tastes.series).toEqual([]);
  });

  it("le classement des lectures : note décroissante, puis la fin la plus récente", () => {
    const result = computeStats(
      [
        book({ title: "Moyen", readings: [finished("2026-07-01", { rating: 3 })] }),
        book({ title: "Excellent ancien", readings: [finished("2026-01-01", { rating: 5 })] }),
        book({ title: "Excellent récent", readings: [finished("2026-07-05", { rating: 5 })] }),
        book({ title: "Pas noté", readings: [finished("2026-07-06")] }),
      ],
      CURRENT_MONTH,
    );
    expect(result.tastes.ranking.map((reading) => reading.title)).toEqual([
      "Excellent récent",
      "Excellent ancien",
      "Moyen",
    ]);
  });

  it("aucune note : trois listes vides, aucun crash", () => {
    const result = computeStats([book({ readings: [finished("2026-07-01")] })], CURRENT_MONTH);
    expect(result.tastes.series).toEqual([]);
    expect(result.tastes.publishers).toEqual([]);
    expect(result.tastes.ranking).toEqual([]);
  });
});

describe("lot D — le volume temporel", () => {
  it("la moyenne par mois compte les mois VIDES depuis la première lecture", () => {
    const result = computeStats(
      [
        book({ readings: [finished("2026-05-01"), finished("2026-05-02")] }),
        book({ readings: [finished("2026-07-01")] }),
      ],
      CURRENT_MONTH,
    );
    // 3 lectures sur mai → juillet, juin compris : 3 mois écoulés.
    expect(result.monthly.finishedByMonth).toEqual([
      { month: "2026-05", count: 2 },
      { month: "2026-07", count: 1 },
    ]);
    expect(result.monthly.averagePerMonth).toBeCloseTo(1);
  });

  it("le meilleur mois — à égalité, le plus ancien", () => {
    const result = computeStats(
      [book({ readings: [finished("2026-05-01")] }), book({ readings: [finished("2026-07-01")] })],
      CURRENT_MONTH,
    );
    expect(result.monthly.bestMonth).toEqual({ month: "2026-05", count: 1 });
  });

  it("une seule lecture dans le mois courant : moyenne de 1 sur 1 mois", () => {
    const result = computeStats([book({ readings: [finished("2026-07-01")] })], CURRENT_MONTH);
    expect(result.monthly.averagePerMonth).toBe(1);
    expect(result.monthly.bestMonth).toEqual({ month: "2026-07", count: 1 });
  });

  it("aucune lecture : pas de moyenne, pas de meilleur mois", () => {
    const result = computeStats([], CURRENT_MONTH);
    expect(result.monthly.finishedByMonth).toEqual([]);
    expect(result.monthly.averagePerMonth).toBeNull();
    expect(result.monthly.bestMonth).toBeNull();
  });

  it("une lecture datée APRÈS le mois de référence ne rend pas la moyenne absurde", () => {
    const result = computeStats([book({ readings: [finished("2026-09-01")] })], CURRENT_MONTH);
    // Le plancher à 1 mois évite une division par zéro ou par un négatif.
    expect(result.monthly.averagePerMonth).toBe(1);
  });
});

describe("lot B — les séries en cours et le tome suivant", () => {
  /** Le catalogue d'une série numérotée 1..3, dont les tomes 1 et 2 sont reliés. */
  const CATALOG: SeriesCatalog = {
    issues: [
      { gcdIssueId: 11, seriesId: 7, number: "1" },
      { gcdIssueId: 12, seriesId: 7, number: "2" },
    ],
    series: [{ seriesId: 7, seriesName: "Blacksad (GCD)", numbers: ["1", "2", "3"] }],
  };

  it("croise les tomes lus et la numérotation GCD pour annoncer le suivant", () => {
    const result = computeStats(
      [book({ seriesName: "Blacksad", gcdIssueId: 11, readings: [finished("2026-07-01")] })],
      CURRENT_MONTH,
      { seriesCatalog: CATALOG },
    );
    expect(result.series.inProgress).toEqual([
      {
        seriesId: 7,
        seriesName: "Blacksad",
        volumesRead: 1,
        knownVolumes: 3,
        nextVolume: "2",
        status: "next-known",
        reason: null,
      },
    ]);
  });

  it("une relecture ne fait pas croire à un tome de plus", () => {
    const result = computeStats(
      [book({ seriesName: "Blacksad", gcdIssueId: 11, readings: [finished("2026-07-01"), finished("2026-07-20")] })],
      CURRENT_MONTH,
      { seriesCatalog: CATALOG },
    );
    expect(result.series.inProgress[0].volumesRead).toBe(1);
    expect(result.series.inProgress[0].nextVolume).toBe("2");
  });

  it("un tome acheté mais pas lu ne met pas la série en cours", () => {
    const result = computeStats(
      [book({ seriesName: "Blacksad", gcdIssueId: 11, purchases: [bought("2026-07-01")] })],
      CURRENT_MONTH,
      { seriesCatalog: CATALOG },
    );
    expect(result.series.inProgress).toEqual([]);
  });

  it("sans catalogue, la répartition par série vit toujours mais aucun tome suivant n'est deviné", () => {
    const result = computeStats(
      [book({ seriesName: "Blacksad", gcdIssueId: 11, readings: [finished("2026-07-01")] })],
      CURRENT_MONTH,
    );
    expect(result.series.volumesRead).toEqual([{ seriesName: "Blacksad", count: 1 }]);
    expect(result.series.inProgress).toEqual([]);
  });

  it("un livre non résolu par GCD n'entre pas dans les séries en cours", () => {
    const result = computeStats(
      [book({ seriesName: "Blacksad", readings: [finished("2026-07-01")] })],
      CURRENT_MONTH,
      { seriesCatalog: CATALOG },
    );
    expect(result.series.inProgress).toEqual([]);
  });

  it("un tome lu non relié dans la même série fait taire le tome suivant", () => {
    const result = computeStats(
      [
        book({ seriesName: "Blacksad", gcdIssueId: 11, readings: [finished("2026-07-01")] }),
        book({ seriesName: "Blacksad", readings: [finished("2026-07-02")] }),
      ],
      CURRENT_MONTH,
      { seriesCatalog: CATALOG },
    );
    expect(result.series.inProgress[0]).toMatchObject({ volumesRead: 2, status: "unusable", reason: "partial-link" });
  });
});
