import { describe, expect, it } from "vitest";
import { monthSeparatorBefore } from "./month-separator";
import type { JournalEntry } from "./journal-list";

/**
 * Le carnet de lecture (#146, #150) — tests conservés tels quels lors du
 * lot C de #32 (le filtrage et le tri ont migré dans la vue SQL
 * `journal_entries` ; seuls les séparateurs restent côté client).
 */

let entryCounter = 0;

function entry(overrides: {
  id?: string;
  status?: JournalEntry["status"];
  startedAt?: string | null;
  finishedAt?: string | null;
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
      seriesName: null,
      issueNumber: null,
      category: "bd",
      coverUrl: null,
      pageCount: null,
    },
  };
}

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
    const undatedToo = entry({ id: "f", status: "finished", startedAt: null, finishedAt: null });
    expect(monthSeparatorBefore(july, undated)).toBe("sans-date");
    expect(monthSeparatorBefore(undated, undatedToo)).toBeNull();
  });

  it("après une en-cours, la première terminée ouvre son mois", () => {
    expect(monthSeparatorBefore(reading, july)).toBe("2026-07");
  });
});
