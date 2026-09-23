import { describe, expect, it, vi } from "vitest";
import type { GcdSeries } from "./providers/gcd";
import { resolveDeferredCover, resolveScannedCode, type ResolutionDeps } from "./resolve";

/**
 * L'identité avant la couverture (fluidité #332, item 3) : avec `deferCover`,
 * la cascade rend le livre dès qu'une source l'identifie, sans dérouler la
 * chaîne couverture ; la seconde phase (`resolveDeferredCover`) la déroule et
 * complète le cache comme si tout s'était fait d'un coup.
 */
function deps(overrides: {
  bnf?: Partial<ResolutionDeps["bnf"]>;
  googleBooks?: Partial<ResolutionDeps["googleBooks"]>;
  openLibrary?: Partial<ResolutionDeps["openLibrary"]>;
  cache?: Partial<ResolutionDeps["cache"]>;
} = {}): ResolutionDeps {
  return {
    gcd: {
      findIssuesByBarcode: vi.fn(async () => []),
      findIssuesByIsbn: vi.fn(async () => []),
      findIssuesByPrefix: vi.fn(async () => []),
      getIssueByGcdId: vi.fn(async () => null),
      getSeriesByIds: vi.fn(async () => new Map<number, GcdSeries>()),
    },
    bnf: { resolveIsbn: vi.fn(async () => null), searchSeriesFloors: vi.fn(async () => new Map()), ...overrides.bnf },
    googleBooks: { resolveIsbn: vi.fn(async () => null), ...overrides.googleBooks },
    openLibrary: { findCoverByIsbn: vi.fn(async () => null), searchEditionCovers: vi.fn(async () => []), ...overrides.openLibrary },
    inventaire: { findCoverByIsbn: vi.fn(async () => null) },
    bnfCovers: { findCoverByIsbn: vi.fn(async () => null) },
    epagine: { findCoverByIsbn: vi.fn(async () => null) },
    metron: { findIssueByGcdId: vi.fn(async () => null), findIssueByUpc: vi.fn(async () => null), findIssueById: vi.fn(async () => null) },
    comicVine: { isEnabled: () => false, findIssueCovers: vi.fn(async () => []) },
    cache: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
      stampCoverChecked: vi.fn(async () => {}),
      getMiss: vi.fn(async () => null),
      setMiss: vi.fn(async () => {}),
      ...overrides.cache,
    },
  } as ResolutionDeps;
}

const ISBN = "9782344036952";
const bnfRecord = {
  title: "Astérix chez les Pictes",
  seriesName: "Astérix",
  issueNumber: "35",
  bnfSeriesId: null,
  authors: "Ferri, Conrad",
  publisher: "Albert René",
  pageCount: 48,
};

describe("resolveScannedCode avec deferCover — l'identité d'abord", () => {
  it("un livre BnF revient identifié, coverPending, SANS appeler Google Books ni les replis ; l'entrée est cachée sans image", async () => {
    const d = deps({ bnf: { resolveIsbn: vi.fn(async () => bnfRecord) } });
    const result = await resolveScannedCode(ISBN, d, null, { deferCover: true });
    expect(result).toMatchObject({ kind: "resolved", coverPending: true });
    if (result.kind === "resolved") expect(result.book).toMatchObject({ title: "Astérix chez les Pictes", coverUrl: null });
    expect(d.googleBooks.resolveIsbn).not.toHaveBeenCalled();
    expect(d.openLibrary.findCoverByIsbn).not.toHaveBeenCalled();
    expect(d.cache.set).toHaveBeenCalledWith(expect.objectContaining({ barcode: ISBN, coverUrl: null, source: "bnf" }));
  });

  it("sans deferCover, le comportement historique : la chaîne couverture tourne", async () => {
    const d = deps({ bnf: { resolveIsbn: vi.fn(async () => bnfRecord) } });
    const result = await resolveScannedCode(ISBN, d);
    expect(result).not.toHaveProperty("coverPending");
    expect(d.googleBooks.resolveIsbn).toHaveBeenCalled();
  });

  it("introuvable et différé : « not-found » tout de suite, cache négatif SANS image, replis non appelés", async () => {
    const d = deps();
    const result = await resolveScannedCode(ISBN, d, null, { deferCover: true });
    expect(result).toEqual({ kind: "not-found", coverUrl: null, coverPending: true });
    expect(d.cache.setMiss).toHaveBeenCalledWith(ISBN, null);
    expect(d.openLibrary.findCoverByIsbn).not.toHaveBeenCalled();
  });
});

describe("resolveDeferredCover — la seconde phase", () => {
  it("déroule la chaîne et pose l'image sur l'entrée cachée", async () => {
    const entry = { barcode: ISBN, title: "Astérix chez les Pictes", seriesName: "Astérix", issueNumber: "35", authors: null, publisher: null, pageCount: 48, coverUrl: null, source: "bnf" as const, sourceId: null };
    const d = deps({
      cache: { get: vi.fn(async () => entry) },
      openLibrary: { findCoverByIsbn: vi.fn(async () => "https://covers.openlibrary.org/b/id/1-L.jpg") },
    });
    expect(await resolveDeferredCover(ISBN, d)).toBe("https://covers.openlibrary.org/b/id/1-L.jpg");
    expect(d.cache.set).toHaveBeenCalledWith(expect.objectContaining({ barcode: ISBN, coverUrl: "https://covers.openlibrary.org/b/id/1-L.jpg" }));
  });

  it("rien trouvé sur verdict propre : l'entrée est tamponnée « vérifiée sans image » (#176)", async () => {
    const entry = { barcode: ISBN, title: "X", seriesName: null, issueNumber: null, authors: null, publisher: null, pageCount: null, coverUrl: null, source: "bnf" as const, sourceId: null };
    const d = deps({ cache: { get: vi.fn(async () => entry) } });
    expect(await resolveDeferredCover(ISBN, d)).toBeNull();
    expect(d.cache.stampCoverChecked).toHaveBeenCalledWith(ISBN);
    expect(d.cache.set).not.toHaveBeenCalled();
  });

  it("déjà comblée entre-temps : rend l'image du cache sans appel externe", async () => {
    const entry = { barcode: ISBN, title: "X", seriesName: null, issueNumber: null, authors: null, publisher: null, pageCount: null, coverUrl: "https://books.google.com/c.jpg", source: "bnf" as const, sourceId: null };
    const d = deps({ cache: { get: vi.fn(async () => entry) } });
    expect(await resolveDeferredCover(ISBN, d)).toBe("https://books.google.com/c.jpg");
    expect(d.googleBooks.resolveIsbn).not.toHaveBeenCalled();
  });

  it("introuvable en phase 1 : l'image de la saisie manuelle complète le cache négatif (#55)", async () => {
    const d = deps({
      cache: { getMiss: vi.fn(async () => ({ lastCheckedAt: new Date().toISOString(), coverUrl: null })) },
      openLibrary: { findCoverByIsbn: vi.fn(async () => "https://covers.openlibrary.org/b/id/2-L.jpg") },
    });
    expect(await resolveDeferredCover(ISBN, d)).toBe("https://covers.openlibrary.org/b/id/2-L.jpg");
    expect(d.cache.setMiss).toHaveBeenCalledWith(ISBN, "https://covers.openlibrary.org/b/id/2-L.jpg");
  });

  it("un UPC n'est jamais différé : null, aucun appel", async () => {
    const d = deps();
    expect(await resolveDeferredCover("76194134174312311", d)).toBeNull();
    expect(d.cache.get).not.toHaveBeenCalled();
  });
});
