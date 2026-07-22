import { describe, expect, it } from "vitest";
import {
  distinctMonths,
  distinctSeriesNames,
  filterJournalEntries,
  monthSeparatorBefore,
  NO_JOURNAL_FILTERS,
  sortJournalEntries,
} from "./filter-journal-entries";
import type { JournalEntry } from "./journal-list";

/**
 * Les filtres du journal (§4.2) — état, catégorie, série, mois, en ET
 * logique. Un test = une situation de lecteur.
 */

let entryCounter = 0;

function entry(overrides: {
  id?: string;
  status?: JournalEntry["status"];
  startedAt?: string | null;
  finishedAt?: string | null;
  category?: JournalEntry["book"]["category"];
  seriesName?: string | null;
} = {}): JournalEntry {
  entryCounter += 1;
  return {
    id: overrides.id ?? `reading-${entryCounter}`,
    status: overrides.status ?? "finished",
    startedAt: overrides.startedAt === undefined ? "2026-07-01" : overrides.startedAt,
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

describe("sortJournalEntries (#146) — l'activité d'abord, le temps ensuite, le sans-date à la fin", () => {
  const reading = entry({ id: "en-cours", status: "reading", startedAt: "2026-07-10" });
  const justFinished = entry({ id: "fini-hier", status: "finished", startedAt: "2026-07-01", finishedAt: "2026-07-21" });
  const finishedInJune = entry({ id: "fini-juin", status: "finished", startedAt: "2026-06-01", finishedAt: "2026-06-15" });
  const abandoned = entry({ id: "abandonne", status: "abandoned", startedAt: "2026-07-05" });
  const undated = entry({ id: "sans-date", status: "finished", startedAt: null, finishedAt: null });

  it("le sans-date ne peut plus JAMAIS enterrer la lecture en cours (le bug du tri SQL)", () => {
    // PostgreSQL sort les NULL en premier en desc : les « déjà lu » de rafale
    // arrivaient en tête. Ici on fige l'ordre voulu, quel que soit l'ordre reçu.
    const sorted = sortJournalEntries([undated, finishedInJune, abandoned, justFinished, reading]);
    expect(sorted.map((item) => item.id)).toEqual(["en-cours", "fini-hier", "fini-juin", "abandonne", "sans-date"]);
  });

  it("dans les terminées, la FIN la plus récente d'abord — « je viens de le lire » en haut", () => {
    const sorted = sortJournalEntries([finishedInJune, justFinished]);
    expect(sorted[0].id).toBe("fini-hier");
  });

  it("ne mute pas la liste d'origine", () => {
    const input = [undated, reading];
    sortJournalEntries(input);
    expect(input[0].id).toBe("sans-date");
  });
});

describe("monthSeparatorBefore (#146) — le carnet de lecture", () => {
  const july = entry({ id: "a", status: "finished", startedAt: null, finishedAt: "2026-07-21" });
  const julyToo = entry({ id: "b", status: "finished", startedAt: null, finishedAt: "2026-07-02" });
  const june = entry({ id: "c", status: "finished", startedAt: null, finishedAt: "2026-06-15" });
  const reading = entry({ id: "d", status: "reading", startedAt: "2026-07-10" });
  const undated = entry({ id: "e", status: "finished", startedAt: null, finishedAt: null });

  it("un séparateur quand le mois de fin change, aucun sinon", () => {
    expect(monthSeparatorBefore(null, july)).toBe("2026-07");
    expect(monthSeparatorBefore(july, julyToo)).toBeNull();
    expect(monthSeparatorBefore(julyToo, june)).toBe("2026-06");
  });

  it("jamais de séparateur de MOIS hors de la section des terminées datées", () => {
    expect(monthSeparatorBefore(null, reading)).toBeNull();
  });

  it("le groupe sans date ouvre son en-tête « sans-date », une seule fois (#150)", () => {
    // L'étagère d'avant, saisie pour mettre les données à jour : jamais
    // mélangée visuellement au mois courant.
    const undatedToo = entry({ id: "f", status: "finished", startedAt: null, finishedAt: null });
    expect(monthSeparatorBefore(july, undated)).toBe("sans-date");
    expect(monthSeparatorBefore(undated, undatedToo)).toBeNull();
  });

  it("après une en-cours, la première terminée ouvre son mois", () => {
    expect(monthSeparatorBefore(reading, july)).toBe("2026-07");
  });
});
