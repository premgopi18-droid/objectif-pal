import { describe, expect, it, vi } from "vitest";
import type { ResolutionDeps } from "@/lib/resolution/resolve";
import type { MetronIssue } from "@/lib/resolution/providers/metron";
import { listCoverCandidates, listEditionCandidates } from "./candidates";

/**
 * Le sélecteur (#276) : toutes les sources en parallèle, ce qui arrive dans
 * le budget est rendu, une panne n'empêche pas les autres, et la variante
 * scannée est présélectionnée.
 */

const wait = (ms: number, value: string | null) => new Promise<string | null>((resolve) => setTimeout(() => resolve(value), ms));

function deps(overrides: Partial<{ [K in keyof ResolutionDeps]: Partial<ResolutionDeps[K]> }> = {}): ResolutionDeps {
  return {
    gcd: {} as ResolutionDeps["gcd"],
    bnf: {} as ResolutionDeps["bnf"],
    cache: {} as ResolutionDeps["cache"],
    googleBooks: { resolveIsbn: vi.fn(async () => null), ...overrides.googleBooks } as ResolutionDeps["googleBooks"],
    openLibrary: { findCoverByIsbn: vi.fn(async () => null), ...overrides.openLibrary } as ResolutionDeps["openLibrary"],
    inventaire: { findCoverByIsbn: vi.fn(async () => null), ...overrides.inventaire } as ResolutionDeps["inventaire"],
    bnfCovers: { findCoverByIsbn: vi.fn(async () => null), ...overrides.bnfCovers } as ResolutionDeps["bnfCovers"],
    epagine: { findCoverByIsbn: vi.fn(async () => null), ...overrides.epagine } as ResolutionDeps["epagine"],
    metron: { findIssueByGcdId: vi.fn(async () => null), findIssueByUpc: vi.fn(async () => null), ...overrides.metron } as ResolutionDeps["metron"],
  };
}

const ISBN_BOOK = { barcodeType: "isbn" as const, barcode: "9782344012345", isbn: "9782344012345" };
const UPC_BOOK = { barcodeType: "upc" as const, barcode: "76194139422000421", isbn: null };

const metronIssue = (overrides: Partial<MetronIssue> = {}): MetronIssue => ({
  metronId: 1,
  issueName: null,
  seriesName: "Absolute Green Arrow",
  number: "4",
  coverUrl: "https://static.metron.cloud/b.jpg",
  mainCoverUrl: "https://static.metron.cloud/main.jpg",
  variants: [
    { name: "Cover B Martin Simmonds Variant", upc: "76194139422000421", coverUrl: "https://static.metron.cloud/b.jpg" },
    { name: "616 Comics Björn Barends Variant", upc: null, coverUrl: "https://static.metron.cloud/616.jpg" },
  ],
  matchedVariantUpc: "76194139422000421",
  seriesType: "Single Issue",
  publisher: "DC",
  pageCount: 32,
  ...overrides,
});

describe("listCoverCandidates — ISBN", () => {
  it("les 5 sources sont appelées en parallèle et toutes les images distinctes remontent, dans l'ordre", async () => {
    const d = deps({
      googleBooks: { resolveIsbn: vi.fn(async () => ({ coverUrl: "https://books.google.com/g.jpg" }) as never) },
      openLibrary: { findCoverByIsbn: vi.fn(() => wait(30, "https://covers.openlibrary.org/o.jpg")) },
      inventaire: { findCoverByIsbn: vi.fn(() => wait(5, "https://inventaire.io/img/entities/400x400/i")) },
      epagine: { findCoverByIsbn: vi.fn(async () => "https://images.epagine.fr/345/e.jpg") },
    });
    const started = Date.now();
    const result = await listCoverCandidates(ISBN_BOOK, d, 1000);

    expect(result.degraded).toBe(false);
    expect(result.candidates.map((candidate) => candidate.source)).toEqual(["google_books", "open_library", "inventaire", "epagine"]);
    expect(result.candidates.every((candidate) => !candidate.preselected)).toBe(true);
    // Parallèle : bien moins que la somme des délais séquentiels.
    expect(Date.now() - started).toBeLessThan(500);
    expect(d.bnfCovers.findCoverByIsbn).toHaveBeenCalledWith(ISBN_BOOK.isbn);
  });

  it("une source qui rejette : les autres remontent, degraded = true", async () => {
    const d = deps({
      googleBooks: { resolveIsbn: vi.fn(async () => { throw new Error("429"); }) },
      openLibrary: { findCoverByIsbn: vi.fn(async () => "https://covers.openlibrary.org/o.jpg") },
    });
    const result = await listCoverCandidates(ISBN_BOOK, d);
    expect(result.degraded).toBe(true);
    expect(result.candidates.map((candidate) => candidate.url)).toEqual(["https://covers.openlibrary.org/o.jpg"]);
  });

  it("doublons d'URL fusionnés, première source gagnante", async () => {
    const same = "https://covers.openlibrary.org/o.jpg";
    const d = deps({
      openLibrary: { findCoverByIsbn: vi.fn(async () => same) },
      inventaire: { findCoverByIsbn: vi.fn(async () => same) },
    });
    const result = await listCoverCandidates(ISBN_BOOK, d);
    expect(result.candidates).toEqual([{ url: same, source: "open_library", label: "OpenLibrary", preselected: false }]);
  });

  it("budget dépassé : ce qui est arrivé est rendu, degraded = true", async () => {
    const d = deps({
      openLibrary: { findCoverByIsbn: vi.fn(async () => "https://covers.openlibrary.org/o.jpg") },
      epagine: { findCoverByIsbn: vi.fn(() => wait(500, "https://images.epagine.fr/345/e.jpg")) },
    });
    const result = await listCoverCandidates(ISBN_BOOK, d, 50);
    expect(result.degraded).toBe(true);
    expect(result.candidates.map((candidate) => candidate.source)).toEqual(["open_library"]);
  });
});

describe("listCoverCandidates — UPC (Metron)", () => {
  it("principale + variantes, la variante scannée seule présélectionnée", async () => {
    const d = deps({ metron: { findIssueByUpc: vi.fn(async () => metronIssue()) } });
    const result = await listCoverCandidates(UPC_BOOK, d);
    expect(result.candidates.map((candidate) => [candidate.label, candidate.preselected])).toEqual([
      ["Metron · Couverture principale", false],
      ["Metron · Cover B Martin Simmonds Variant", true],
      ["Metron · 616 Comics Björn Barends Variant", false],
    ]);
    expect(d.metron.findIssueByUpc).toHaveBeenCalledWith(UPC_BOOK.barcode);
  });

  it("le code d'une cover A (4ᵉ chiffre à 1) présélectionne la principale ; une exclusivité sans UPC jamais", async () => {
    const d = deps({ metron: { findIssueByUpc: vi.fn(async () => metronIssue({ matchedVariantUpc: null, coverUrl: "https://static.metron.cloud/main.jpg" })) } });
    const result = await listCoverCandidates({ ...UPC_BOOK, barcode: "76194139422000411" }, d);
    expect(result.candidates.map((candidate) => candidate.preselected)).toEqual([true, false, false]);
  });

  it("une variante que Metron ignore (cover H) n'entoure RIEN — ni la principale (review #281)", async () => {
    const d = deps({ metron: { findIssueByUpc: vi.fn(async () => metronIssue({ matchedVariantUpc: null, coverUrl: "https://static.metron.cloud/main.jpg" })) } });
    const result = await listCoverCandidates({ ...UPC_BOOK, barcode: "76194139422000481" }, d);
    expect(result.candidates.every((candidate) => !candidate.preselected)).toBe(true);
  });

  it("Metron muet ou en panne : liste vide, degraded selon le cas", async () => {
    expect(await listCoverCandidates(UPC_BOOK, deps())).toEqual({ candidates: [], degraded: false });
    const down = deps({ metron: { findIssueByUpc: vi.fn(async () => { throw new Error("quota"); }) } });
    expect(await listCoverCandidates(UPC_BOOK, down)).toEqual({ candidates: [], degraded: true });
  });
});

describe("listCoverCandidates — sans code", () => {
  it("un livre saisi à la main n'interroge aucune source", async () => {
    const d = deps();
    const result = await listCoverCandidates({ barcodeType: null, barcode: null, isbn: null }, d);
    expect(result).toEqual({ candidates: [], degraded: false });
    expect(d.metron.findIssueByUpc).not.toHaveBeenCalled();
    expect(d.openLibrary.findCoverByIsbn).not.toHaveBeenCalled();
  });
});

describe("listEditionCandidates (#277)", () => {
  it("étiquette éditeur + année, ou OpenLibrary seul ; dédoublonne", async () => {
    const d = deps({
      openLibrary: {
        searchEditionCovers: vi.fn(async () => [
          { coverUrl: "https://covers.openlibrary.org/b/id/1-L.jpg", workTitle: "T", publisher: "Gallimard", year: "2015", isbn13: null },
          { coverUrl: "https://covers.openlibrary.org/b/id/2-L.jpg", workTitle: "T", publisher: null, year: "2007", isbn13: null },
          { coverUrl: "https://covers.openlibrary.org/b/id/3-L.jpg", workTitle: "T", publisher: null, year: null, isbn13: null },
          { coverUrl: "https://covers.openlibrary.org/b/id/1-L.jpg", workTitle: "T", publisher: "Folio", year: "2021", isbn13: null },
        ]),
      },
    });
    const result = await listEditionCandidates({ title: "T", author: null }, d);
    expect(result.degraded).toBe(false);
    expect(result.candidates.map((candidate) => candidate.label)).toEqual(["Autre édition · Gallimard 2015", "Autre édition · 2007", "Autre édition · OpenLibrary"]);
    expect(result.candidates.every((candidate) => candidate.source === "open_library_edition" && !candidate.preselected)).toBe(true);
    expect(result.candidates[0].edition).toEqual({ publisher: "Gallimard", year: "2015" });
  });

  it("OpenLibrary en panne : liste vide, degraded", async () => {
    const d = deps({ openLibrary: { searchEditionCovers: vi.fn(async () => { throw new Error("429"); }) } });
    expect(await listEditionCandidates({ title: "T", author: null }, d)).toEqual({ candidates: [], degraded: true });
  });

  it("listCoverCandidates n'appelle JAMAIS la recherche d'éditions (proposée, jamais imposée)", async () => {
    const searchEditionCovers = vi.fn(async () => []);
    const d = deps({ openLibrary: { findCoverByIsbn: vi.fn(async () => null), searchEditionCovers } });
    await listCoverCandidates(ISBN_BOOK, d);
    await listCoverCandidates(UPC_BOOK, d);
    expect(searchEditionCovers).not.toHaveBeenCalled();
  });
});

describe("listEditionCandidates — l'étiquette dit quand c'est une AUTRE œuvre (review #282)", () => {
  it("titre différent du titre cherché : le titre de l'œuvre passe devant", async () => {
    const d = deps({
      openLibrary: {
        searchEditionCovers: vi.fn(async () => [
          { coverUrl: "https://covers.openlibrary.org/b/id/1-L.jpg", workTitle: "Buffy the Vampire Slayer", publisher: "Dark Horse Comics", year: "2014", isbn13: null },
          { coverUrl: "https://covers.openlibrary.org/b/id/2-L.jpg", workTitle: "The vampire slayer", publisher: "Boom", year: "2022", isbn13: null },
        ]),
      },
    });
    const result = await listEditionCandidates({ title: "The Vampire Slayer", author: null }, d);
    expect(result.candidates.map((candidate) => candidate.label)).toEqual([
      "Buffy the Vampire Slayer · Dark Horse Comics 2014",
      "Autre édition · Boom 2022",
    ]);
  });
});
