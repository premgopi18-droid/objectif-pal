import { describe, expect, it } from "vitest";
import {
  distinctMonths,
  distinctSeriesNames,
  filterJournalEntries,
  NO_JOURNAL_FILTERS,
} from "./filter-journal-entries";
import type { JournalEntry } from "./journal-list";

/**
 * Les filtres du journal (§4.2) — état, catégorie, série, mois, en ET
 * logique. Un test = une situation de lecteur.
 */

let entryCounter = 0;

function entry(overrides: {
  status?: JournalEntry["status"];
  startedAt?: string;
  finishedAt?: string | null;
  category?: JournalEntry["book"]["category"];
  seriesName?: string | null;
} = {}): JournalEntry {
  entryCounter += 1;
  return {
    id: `reading-${entryCounter}`,
    status: overrides.status ?? "finished",
    startedAt: overrides.startedAt ?? "2026-07-01",
    finishedAt: overrides.finishedAt === undefined ? "2026-07-10" : overrides.finishedAt,
    rating: null,
    comment: null,
    book: {
      bookId: `book-${entryCounter}`,
      title: `Livre ${entryCounter}`,
      seriesName: overrides.seriesName ?? null,
      issueNumber: null,
      category: overrides.category ?? "bd",
      coverUrl: null,
      pageCount: null,
    },
  };
}

describe("le filtrage combiné", () => {
  it("sans filtre, tout passe", () => {
    const entries = [entry(), entry({ status: "reading", finishedAt: null })];
    expect(filterJournalEntries(entries, NO_JOURNAL_FILTERS)).toEqual(entries);
  });

  it("les quatre dimensions se combinent en ET", () => {
    const match = entry({ status: "finished", category: "manga", seriesName: "Radiant", finishedAt: "2026-07-05" });
    const entries = [
      match,
      entry({ status: "finished", category: "manga", seriesName: "Radiant", finishedAt: "2026-06-20" }), // mauvais mois
      entry({ status: "finished", category: "bd", seriesName: "Radiant", finishedAt: "2026-07-08" }), // mauvaise catégorie
      entry({ status: "abandoned", category: "manga", seriesName: "Radiant", finishedAt: null, startedAt: "2026-07-02" }), // mauvais état
    ];
    expect(
      filterJournalEntries(entries, { status: "finished", category: "manga", seriesName: "Radiant", month: "2026-07" }),
    ).toEqual([match]);
  });

  it("le mois d'une lecture non terminée est celui de son début", () => {
    const inProgress = entry({ status: "reading", finishedAt: null, startedAt: "2026-05-20" });
    expect(filterJournalEntries([inProgress], { ...NO_JOURNAL_FILTERS, month: "2026-05" })).toEqual([inProgress]);
    // Une terminée est datée par sa FIN, même commencée un autre mois.
    const finished = entry({ startedAt: "2026-05-20", finishedAt: "2026-07-02" });
    expect(filterJournalEntries([finished], { ...NO_JOURNAL_FILTERS, month: "2026-05" })).toEqual([]);
    expect(filterJournalEntries([finished], { ...NO_JOURNAL_FILTERS, month: "2026-07" })).toEqual([finished]);
  });

  it("filtrer sur une série exclut les hors-série", () => {
    const inSeries = entry({ seriesName: "Radiant" });
    const standalone = entry({ seriesName: null });
    expect(filterJournalEntries([inSeries, standalone], { ...NO_JOURNAL_FILTERS, seriesName: "Radiant" })).toEqual([
      inSeries,
    ]);
  });
});

describe("les options dérivées", () => {
  it("les séries distinctes, triées, sans les hors-série", () => {
    const entries = [
      entry({ seriesName: "Radiant" }),
      entry({ seriesName: "Astérix" }),
      entry({ seriesName: "Radiant" }),
      entry({ seriesName: null }),
    ];
    expect(distinctSeriesNames(entries)).toEqual(["Astérix", "Radiant"]);
  });

  it("les mois distincts, du plus récent au plus ancien", () => {
    const entries = [
      entry({ finishedAt: "2026-03-10" }),
      entry({ status: "reading", finishedAt: null, startedAt: "2026-07-01" }),
      entry({ finishedAt: "2025-12-25" }),
      entry({ finishedAt: "2026-03-02" }),
    ];
    expect(distinctMonths(entries)).toEqual(["2026-07", "2026-03", "2025-12"]);
  });
});
