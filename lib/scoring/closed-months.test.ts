import { describe, expect, it } from "vitest";
import { buildStoredMonthlyReport, listClosedActivityMonths, type BilanReadingFact } from "./closed-months";
import { computeMonthlyReport } from "./monthly-report";
import type { PurchaseFact } from "./types";

/**
 * La matérialisation des mois clos (epic #182) : quels mois méritent une
 * ligne, et ce qu'elle contient. Le BARÈME n'est pas re-testé ici (il a ses
 * tests) — on vérifie l'emballage : périmètre des mois, égalité avec le
 * moteur, liste des terminées.
 */

let counter = 0;
/** Les métadonnées publiques neutres du livre de test (#236). */
const emptyBook = {
  coverUrl: null,
  seriesName: null,
  authors: null,
  publisher: null,
  pageCount: null,
  isbn: null,
};
const reading = (overrides: Partial<BilanReadingFact> = {}): BilanReadingFact => {
  counter += 1;
  return {
    readingId: `reading-${counter}`,
    title: overrides.title ?? `Livre ${counter}`,
    bookId: `book-${counter}`,
    category: "bd",
    status: "finished",
    startedAt: null,
    finishedAt: "2026-06-10",
    book: emptyBook,
    ...overrides,
  };
};
const purchase = (purchasedAt: string, bookId = `book-achat-${++counter}`): PurchaseFact => ({ bookId, purchasedAt });

describe("listClosedActivityMonths", () => {
  it("un mois compte s'il a une fin de lecture, un achat OU un objectif — trié, sans doublon", () => {
    const months = listClosedActivityMonths(
      {
        readings: [reading({ finishedAt: "2026-06-10" }), reading({ finishedAt: "2026-06-21" })],
        purchases: [purchase("2026-05-03")],
        objectivesByMonth: { "2026-04": { bd: 2 } },
      },
      "2026-08",
    );
    expect(months).toEqual(["2026-04", "2026-05", "2026-06"]);
  });

  it("le mois COURANT et le futur n'ont jamais de ligne — le reveal reste à l'antenne (§4.14)", () => {
    const months = listClosedActivityMonths(
      {
        readings: [reading({ finishedAt: "2026-08-01" }), reading({ finishedAt: "2026-07-30" })],
        purchases: [purchase("2026-09-01")],
        objectivesByMonth: {},
      },
      "2026-08",
    );
    expect(months).toEqual(["2026-07"]);
  });

  it("une lecture sans date de fin, en cours ou abandonnée n'ouvre aucun mois", () => {
    const months = listClosedActivityMonths(
      {
        readings: [
          reading({ finishedAt: null }),
          reading({ status: "reading", finishedAt: null, startedAt: "2026-05-01" }),
          reading({ status: "abandoned", finishedAt: null, startedAt: "2026-05-01" }),
        ],
        purchases: [],
        objectivesByMonth: {},
      },
      "2026-08",
    );
    expect(months).toEqual([]);
  });
});

describe("buildStoredMonthlyReport", () => {
  it("le rapport stocké est EXACTEMENT celui du moteur — même entrée, même sortie", () => {
    const facts = {
      readings: [reading({ finishedAt: "2026-06-10", category: "manga" as const })],
      purchases: [purchase("2026-06-05")],
      objectivesByMonth: { "2026-06": { manga: 1 } },
    };
    const stored = buildStoredMonthlyReport("2026-06", facts);
    expect(stored.report).toEqual(
      computeMonthlyReport("2026-06", {
        readings: facts.readings,
        purchases: facts.purchases,
        objective: facts.objectivesByMonth["2026-06"],
      }),
    );
  });

  it("les terminées du mois : celles du mois SEULEMENT, triées par titre", () => {
    const stored = buildStoredMonthlyReport("2026-06", {
      readings: [
        reading({ finishedAt: "2026-06-20", title: "Zola" }),
        reading({ finishedAt: "2026-06-01", title: "Astérix" }),
        reading({ finishedAt: "2026-07-01", title: "Hors mois" }),
        reading({ finishedAt: null, title: "Sans date" }),
      ],
      purchases: [],
      objectivesByMonth: {},
    });
    expect(stored.finishedReadings.map((entry) => entry.title)).toEqual(["Astérix", "Zola"]);
  });

  it("les terminées embarquent les métadonnées PUBLIQUES du livre (#236) — et la catégorie de la lecture", () => {
    const stored = buildStoredMonthlyReport("2026-06", {
      readings: [
        reading({
          finishedAt: "2026-06-10",
          title: "Feral. tome I",
          category: "comics",
          book: {
            coverUrl: "https://exemple.test/cover.webp",
            seriesName: "Feral",
            authors: "Tony Fleecs",
            publisher: "Panini France",
            pageCount: 128,
            isbn: "9791039127967",
          },
        }),
      ],
      purchases: [],
      objectivesByMonth: {},
    });
    expect(stored.finishedReadings).toEqual([
      {
        readingId: expect.any(String),
        title: "Feral. tome I",
        category: "comics",
        coverUrl: "https://exemple.test/cover.webp",
        seriesName: "Feral",
        authors: "Tony Fleecs",
        publisher: "Panini France",
        pageCount: 128,
        isbn: "9791039127967",
      },
    ]);
  });
});
