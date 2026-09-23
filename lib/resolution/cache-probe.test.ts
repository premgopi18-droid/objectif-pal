import { describe, expect, it, vi } from "vitest";
import type { GcdSeries } from "./providers/gcd";
import { probeResolutionCache, resolveScannedCode, type ResolutionDeps } from "./resolve";

/**
 * La sonde du cache (fluidité #332, item 4) : la route lit le cache EN MÊME
 * TEMPS que la bibliothèque et le quota, puis passe le résultat à la cascade,
 * qui ne doit plus relire le cache — ni pour un hit, ni pour un miss.
 */
function silentDeps(cache: Partial<ResolutionDeps["cache"]>): ResolutionDeps {
  return {
    gcd: {
      findIssuesByBarcode: vi.fn(async () => []),
      findIssuesByIsbn: vi.fn(async () => []),
      findIssuesByPrefix: vi.fn(async () => []),
      getIssueByGcdId: vi.fn(async () => null),
      getSeriesByIds: vi.fn(async () => new Map<number, GcdSeries>()),
    },
    bnf: { resolveIsbn: vi.fn(async () => null), searchSeriesFloors: vi.fn(async () => new Map()) },
    googleBooks: { resolveIsbn: vi.fn(async () => null) },
    openLibrary: { findCoverByIsbn: vi.fn(async () => null), searchEditionCovers: vi.fn(async () => []) },
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
      ...cache,
    },
  } as ResolutionDeps;
}

const cachedEntry = {
  barcode: "9782344036952",
  title: "Astérix chez les Pictes",
  seriesName: "Astérix",
  issueNumber: "35",
  authors: null,
  publisher: "Albert René",
  pageCount: 48,
  coverUrl: "https://books.google.com/cover.jpg",
  coverCheckedAt: new Date().toISOString(),
  source: "bnf" as const,
  sourceId: null,
};

describe("probeResolutionCache — le cache lu en un étage, avant la cascade", () => {
  it("lit l'entrée ET le cache négatif en parallèle, sous la clé EAN-13 pour un ISBN (supplément prix ignoré)", async () => {
    const deps = silentDeps({});
    const probe = await probeResolutionCache("978234403695251095", deps);
    expect(probe).toEqual({ cached: null, recentMiss: null });
    expect(deps.cache.get).toHaveBeenCalledWith("9782344036952");
    expect(deps.cache.getMiss).toHaveBeenCalledWith("9782344036952");
  });

  it("sous le code BRUT pour un UPC (le supplément y est signifiant)", async () => {
    const deps = silentDeps({});
    await probeResolutionCache("76194134174312311", deps);
    expect(deps.cache.get).toHaveBeenCalledWith("76194134174312311");
  });

  it("rend null pour un code invalide", async () => {
    expect(await probeResolutionCache("abc", silentDeps({}))).toBeNull();
  });

  it("un hit passé à la cascade : le livre revient SANS relire le cache ni appeler une source", async () => {
    const deps = silentDeps({ get: vi.fn(async () => cachedEntry) });
    const probe = await probeResolutionCache("9782344036952", deps);
    expect(deps.cache.get).toHaveBeenCalledTimes(1);

    const result = await resolveScannedCode("9782344036952", deps, probe);
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") expect(result.book.title).toBe("Astérix chez les Pictes");
    expect(deps.cache.get).toHaveBeenCalledTimes(1);
    expect(deps.cache.getMiss).toHaveBeenCalledTimes(1);
    expect(deps.bnf.resolveIsbn).not.toHaveBeenCalled();
  });

  it("un miss récent passé à la cascade : « introuvable » sans relire ni interroger", async () => {
    const deps = silentDeps({
      getMiss: vi.fn(async () => ({ lastCheckedAt: new Date().toISOString(), coverUrl: null })),
    });
    const probe = await probeResolutionCache("9782344036952", deps);
    const result = await resolveScannedCode("9782344036952", deps, probe);
    expect(result.kind).toBe("not-found");
    expect(deps.cache.getMiss).toHaveBeenCalledTimes(1);
    expect(deps.gcd.findIssuesByIsbn).not.toHaveBeenCalled();
  });

  it("sans sonde, la cascade lit le cache elle-même (comportement historique)", async () => {
    const deps = silentDeps({ get: vi.fn(async () => cachedEntry) });
    const result = await resolveScannedCode("9782344036952", deps);
    expect(result.kind).toBe("resolved");
    expect(deps.cache.get).toHaveBeenCalledTimes(1);
  });
});
