import { describe, expect, it, vi } from "vitest";
import type { ResolutionDeps } from "@/lib/resolution/resolve";
import type { MetronIssue } from "@/lib/resolution/providers/metron";
import { listCoverCandidates } from "./candidates";

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
    expect(Date.now() - started).toBeLessThan(200);
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

  it("sans variante correspondante, la principale est présélectionnée ; une exclusivité sans UPC jamais", async () => {
    const d = deps({ metron: { findIssueByUpc: vi.fn(async () => metronIssue({ matchedVariantUpc: null, coverUrl: "https://static.metron.cloud/main.jpg" })) } });
    const result = await listCoverCandidates(UPC_BOOK, d);
    expect(result.candidates.map((candidate) => candidate.preselected)).toEqual([true, false, false]);
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
