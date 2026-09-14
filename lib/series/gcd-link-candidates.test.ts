import { describe, expect, it } from "vitest";
import { bookPublisherFamily, gcdPublisherFamily, pickGcdCandidate, type GcdSeriesCandidate } from "./gcd-link-candidates";

const candidate = (id: number, name: string, publisher: string, overrides: Partial<GcdSeriesCandidate> = {}): GcdSeriesCandidate => ({
  id,
  name,
  publisher,
  yearBegan: 2010,
  yearEnded: 2014,
  isCurrent: false,
  lastNumber: 4,
  ...overrides,
});

describe("familles d'éditeur — table explicite, comparée sans accents ni casse", () => {
  it("les variantes des livres (BnF) tombent dans leur famille", () => {
    expect(bookPublisherFamily("Panini comics (Nice)")).toBe("panini");
    expect(bookPublisherFamily("Panini France (Nice)")).toBe("panini");
    expect(bookPublisherFamily("Panini")).toBe("panini");
    expect(bookPublisherFamily("Urban comics (Paris)")).toBe("urban");
    expect(bookPublisherFamily("Glénat (Grenoble)")).toBe("glenat");
    expect(bookPublisherFamily("le Lombard (Bruxelles)")).toBe("lombard");
    expect(bookPublisherFamily("Taïfu Comics")).toBe("taifu");
    expect(bookPublisherFamily("Lorestone (Paris)")).toBeNull();
    expect(bookPublisherFamily(null)).toBeNull();
  });

  it("les noms GCD tombent dans la même famille — et rien d'autre (pas de préfixe)", () => {
    expect(gcdPublisherFamily("Panini France")).toBe("panini");
    expect(gcdPublisherFamily("Urban Comics")).toBe("urban");
    expect(gcdPublisherFamily("Pika Édition")).toBe("pika");
    expect(gcdPublisherFamily("Panini Comics (Italie)")).toBeNull();
    expect(gcdPublisherFamily("Éditions USA")).toBeNull();
  });
});

describe("pickGcdCandidate — nom + famille + année, candidat unique", () => {
  it("Batwoman chez Urban : un seul candidat français chez Urban → unique", () => {
    const verdict = pickGcdCandidate({
      seriesName: "Batwoman",
      publisher: "Urban comics (Paris)",
      oldestYear: 2013,
      maxOwnedNumber: 2,
      candidates: [candidate(68109, "Batwoman", "Urban Comics", { yearBegan: 2012 }), candidate(1, "Batwoman", "DC", { yearBegan: 2011 })],
    });
    expect(verdict).toMatchObject({ kind: "unique", candidate: { id: 68109 }, closedEdition: true });
  });

  it("un tome possédé au-delà du dernier numéro d'une édition close : pas cette édition (review #312)", () => {
    const old = candidate(173149, "Generation X", "Panini France", { yearBegan: 1999, yearEnded: 1999, lastNumber: 1 });
    expect(pickGcdCandidate({ seriesName: "Generation X", publisher: "Panini comics (Nice)", oldestYear: null, maxOwnedNumber: 3, candidates: [old] })).toEqual({
      kind: "none",
      reason: "no-match",
    });
    // Tome 1 seul : rien ne l'exclut, mais l'édition close est signalée pour la validation humaine.
    expect(pickGcdCandidate({ seriesName: "Generation X", publisher: "Panini", oldestYear: null, maxOwnedNumber: 1, candidates: [old] })).toMatchObject({ kind: "unique", closedEdition: true });
    // Une série en cours n'est jamais bornée par son dernier numéro connu.
    const ongoing = candidate(161642, "Deadly Class", "Urban Comics", { yearEnded: null, isCurrent: true, lastNumber: 12 });
    expect(pickGcdCandidate({ seriesName: "Deadly Class", publisher: "Urban Comics", oldestYear: null, maxOwnedNumber: 14, candidates: [ongoing] })).toMatchObject({ kind: "unique", closedEdition: false });
  });

  it("Spider-Man chez Panini : plusieurs séries françaises homonymes → ambigu, jamais relié", () => {
    const verdict = pickGcdCandidate({
      seriesName: "Spider-Man",
      publisher: "Panini comics (Nice)",
      oldestYear: null,
      maxOwnedNumber: null,
      candidates: [candidate(43275, "Spider-Man", "Panini France"), candidate(67090, "Spider-Man", "Panini France"), candidate(79271, "Spider-Man", "Bethy")],
    });
    expect(verdict.kind).toBe("ambiguous");
    if (verdict.kind === "ambiguous") expect(verdict.candidates.map((entry) => entry.id)).toEqual([43275, 67090]);
  });

  it("une série GCD plus récente que le plus ancien livre n'est pas la bonne édition", () => {
    const verdict = pickGcdCandidate({
      seriesName: "Witchblade",
      publisher: "Delcourt (Paris)",
      oldestYear: 2005,
      maxOwnedNumber: null,
      candidates: [candidate(70310, "Witchblade", "Delcourt", { yearBegan: 2012 })],
    });
    expect(verdict).toEqual({ kind: "none", reason: "no-match" });
    // Sans année connue côté livre : pas de filtre.
    expect(pickGcdCandidate({ seriesName: "Witchblade", publisher: "Delcourt", oldestYear: null, maxOwnedNumber: null, candidates: [candidate(70310, "Witchblade", "Delcourt", { yearBegan: 2012 })] }).kind).toBe("unique");
  });

  it("la casse et les accents du nom ne comptent pas (« Eye shield 21 » / « Eye Shield 21 »)", () => {
    const verdict = pickGcdCandidate({
      seriesName: "Eye shield 21",
      publisher: "Glénat (Grenoble)",
      oldestYear: null,
      maxOwnedNumber: null,
      candidates: [candidate(134247, "Eye Shield 21", "Glénat")],
    });
    expect(verdict).toMatchObject({ kind: "unique", candidate: { id: 134247 } });
  });

  it("éditeur hors table (romans, petites maisons) → rien, raison « no-family »", () => {
    expect(pickGcdCandidate({ seriesName: "Arcane", publisher: "Mana books (Paris)", oldestYear: null, maxOwnedNumber: null, candidates: [candidate(1, "Arcane", "Mana Books")] })).toEqual({
      kind: "none",
      reason: "no-family",
    });
  });
});
