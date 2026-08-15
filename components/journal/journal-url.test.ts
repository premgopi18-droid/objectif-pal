import { describe, expect, it } from "vitest";
import {
  JOURNAL_PAGE_SIZE,
  NO_JOURNAL_FILTERS,
  hasActiveJournalFilters,
  journalSearchString,
  parseJournalDepth,
  parseJournalFilters,
  parseJournalSearch,
  parseJournalSort,
} from "./journal-url";

/**
 * Le codec d'URL du journal paginé (#32 lot C) : les searchParams sont une
 * surface PUBLIQUE — une URL forgée ne doit jamais produire un filtre
 * invalide ni une profondeur folle, et le round-trip doit être exact.
 */

describe("parseJournalFilters", () => {
  it("l'URL nue = aucun filtre", () => {
    expect(parseJournalFilters({})).toEqual(NO_JOURNAL_FILTERS);
  });

  it("les quatre dimensions se lisent, round-trip exact avec journalSearchString", () => {
    const filters = { status: "finished", category: "manga", seriesName: "Naruto", month: "2026-07" } as const;
    const roundTripped = parseJournalFilters(Object.fromEntries(new URLSearchParams(journalSearchString(filters))));
    expect(roundTripped).toEqual(filters);
  });

  it("une valeur forgée retombe sur le défaut, jamais sur une erreur", () => {
    expect(parseJournalFilters({ etat: "pirate", categorie: "nope", mois: "juillet" })).toEqual(NO_JOURNAL_FILTERS);
    expect(parseJournalFilters({ etat: ["reading", "finished"] }).status).toBe("reading"); // tableau : première valeur
  });

  it("la série est libre (elle vient des données), le mois est contraint au format YYYY-MM", () => {
    expect(parseJournalFilters({ serie: "Père & fils" }).seriesName).toBe("Père & fils");
    expect(parseJournalFilters({ mois: "2026-13" }).month).toBe("2026-13"); // le format passe — la requête rendra vide, sans casser
    expect(parseJournalFilters({ mois: "07/2026" }).month).toBe("all");
  });
});

describe("parseJournalDepth", () => {
  it("défaut = une page ; « Charger plus » = multiples ; forgé = borné", () => {
    expect(parseJournalDepth({})).toBe(JOURNAL_PAGE_SIZE);
    expect(parseJournalDepth({ n: "100" })).toBe(100);
    expect(parseJournalDepth({ n: "999999" })).toBe(1000);
    expect(parseJournalDepth({ n: "-5" })).toBe(JOURNAL_PAGE_SIZE);
    expect(parseJournalDepth({ n: "abc" })).toBe(JOURNAL_PAGE_SIZE);
  });
});

describe("journalSearchString", () => {
  it("les défauts n'apparaissent pas : l'URL nue reste /journal", () => {
    expect(journalSearchString(NO_JOURNAL_FILTERS)).toBe("");
    expect(journalSearchString(NO_JOURNAL_FILTERS, JOURNAL_PAGE_SIZE)).toBe("");
  });

  it("la profondeur ne s'écrit qu'au-delà d'une page", () => {
    expect(journalSearchString(NO_JOURNAL_FILTERS, JOURNAL_PAGE_SIZE * 2)).toBe("n=100");
  });
});

describe("parseJournalSearch + round-trip (#222)", () => {
  it("défaut = pas de recherche, trim, et une aiguille forgée est bornée", () => {
    expect(parseJournalSearch({})).toBe("");
    expect(parseJournalSearch({ q: "  astérix  " })).toBe("astérix");
    expect(parseJournalSearch({ q: "x".repeat(500) })).toHaveLength(100);
  });

  it("l'aiguille s'écrit dans l'URL et se relit exactement (accents compris)", () => {
    expect(journalSearchString(NO_JOURNAL_FILTERS, JOURNAL_PAGE_SIZE, "activite", "")).toBe("");
    const search = journalSearchString(NO_JOURNAL_FILTERS, JOURNAL_PAGE_SIZE, "activite", "Père & fils");
    const params = Object.fromEntries(new URLSearchParams(search));
    expect(parseJournalSearch(params)).toBe("Père & fils");
  });
});

describe("hasActiveJournalFilters", () => {
  it("détecte la moindre dimension active", () => {
    expect(hasActiveJournalFilters(NO_JOURNAL_FILTERS)).toBe(false);
    expect(hasActiveJournalFilters({ ...NO_JOURNAL_FILTERS, month: "2026-07" })).toBe(true);
  });
});

describe("parseJournalSort + round-trip (#217)", () => {
  it("défaut = activité (#146), les sept tris se lisent, le forgé retombe sur le défaut", () => {
    expect(parseJournalSort({})).toBe("activite");
    expect(parseJournalSort({ tri: "note" })).toBe("note");
    expect(parseJournalSort({ tri: "pirate" })).toBe("activite");
  });

  it("le défaut n'apparaît pas dans l'URL, les autres tris s'y écrivent et se relisent", () => {
    expect(journalSearchString(NO_JOURNAL_FILTERS, JOURNAL_PAGE_SIZE, "activite")).toBe("");
    const search = journalSearchString({ ...NO_JOURNAL_FILTERS, month: "2026-07" }, 100, "titre");
    const params = Object.fromEntries(new URLSearchParams(search));
    expect(parseJournalSort(params)).toBe("titre");
    expect(parseJournalFilters(params).month).toBe("2026-07");
    expect(parseJournalDepth(params)).toBe(100);
  });
});
