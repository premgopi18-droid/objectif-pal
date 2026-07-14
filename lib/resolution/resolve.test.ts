import { describe, expect, it, vi } from "vitest";
import type { GcdIssue, GcdSeries } from "./providers/gcd";
import { resolveScannedCode, type ResolutionDeps } from "./resolve";

/**
 * La cascade testée avec des providers factices : chaque test décrit un
 * bouquin scanné et vérifie où la cascade s'arrête, ce qu'elle propose,
 * et ce qu'elle met (ou non) en cache.
 */

const gcdIssue = (overrides: Partial<GcdIssue> = {}): GcdIssue => ({
  gcdId: 1000,
  barcode: "76194134174312311",
  seriesId: 42,
  number: "123",
  pageCount: 32,
  isbn: null,
  title: null,
  ...overrides,
});

const gcdSeries = (overrides: Partial<GcdSeries> = {}): GcdSeries => ({
  id: 42,
  name: "Nightwing",
  format: null,
  publisher: "DC",
  languageId: 25, // anglais
  ...overrides,
});

/** Des dépendances où TOUT est muet — chaque test allume ce dont il a besoin. */
function fakeDeps(overrides: {
  gcd?: Partial<ResolutionDeps["gcd"]>;
  bnf?: Partial<ResolutionDeps["bnf"]>;
  googleBooks?: Partial<ResolutionDeps["googleBooks"]>;
  metron?: Partial<ResolutionDeps["metron"]>;
  cache?: Partial<ResolutionDeps["cache"]>;
} = {}): ResolutionDeps {
  return {
    gcd: {
      findIssuesByBarcode: vi.fn(async () => []),
      findIssuesByIsbn: vi.fn(async () => []),
      findIssuesByPrefix: vi.fn(async () => []),
      getIssueByGcdId: vi.fn(async () => null),
      getSeriesByIds: vi.fn(async () => new Map<number, GcdSeries>()),
      ...overrides.gcd,
    },
    bnf: { resolveIsbn: vi.fn(async () => null), ...overrides.bnf },
    googleBooks: { resolveIsbn: vi.fn(async () => null), ...overrides.googleBooks },
    metron: {
      findIssueByGcdId: vi.fn(async () => null),
      findIssueByUpc: vi.fn(async () => null),
      ...overrides.metron,
    },
    cache: { get: vi.fn(async () => null), set: vi.fn(async () => {}), ...overrides.cache },
  };
}

describe("la cascade ISBN (GCD → BnF → Google Books)", () => {
  it("une BD franco-belge se résout en base, catégorie bd, sans mise en cache", async () => {
    const deps = fakeDeps({
      gcd: {
        findIssuesByIsbn: vi.fn(async () => [gcdIssue({ isbn: "9782203001114", barcode: null, title: "Tintin et les Picaros" })]),
        getSeriesByIds: vi.fn(async () => new Map([[42, gcdSeries({ name: "Les Aventures de Tintin", publisher: "Casterman", languageId: 34 })]])),
      },
    });
    const result = await resolveScannedCode("9782203001114", deps);

    expect(result).toMatchObject({
      kind: "resolved",
      book: { suggestedCategory: "bd", source: "gcd", seriesName: "Les Aventures de Tintin" },
    });
    // GCD est déjà en base : le cache ne stocke QUE les résolutions externes (specs §6).
    expect(deps.cache.set).not.toHaveBeenCalled();
  });

  it("un TPB VO trouvé par ISBN est proposé comics, et Metron peut le requalifier omnibus", async () => {
    const deps = fakeDeps({
      gcd: {
        findIssuesByIsbn: vi.fn(async () => [gcdIssue({ isbn: "9781302915704", gcdId: 7 })]),
        getSeriesByIds: vi.fn(async () => new Map([[42, gcdSeries({ name: "House of X", publisher: "Marvel" })]])),
      },
      metron: {
        findIssueByGcdId: vi.fn(async () => ({
          metronId: 99,
          issueName: null,
          seriesName: "House of X",
          number: "1",
          coverUrl: "https://static.metron.cloud/cover.jpg",
          seriesType: "Omnibus",
          publisher: "Marvel",
          pageCount: 1096,
        })),
      },
    });
    const result = await resolveScannedCode("9781302915704", deps);

    expect(result).toMatchObject({
      kind: "resolved",
      book: { suggestedCategory: "omnibus", coverUrl: "https://static.metron.cloud/cover.jpg" },
    });
  });

  it("un manga VF absent de GCD est identifié par la BnF, habillé par Google Books, et mis en cache", async () => {
    const deps = fakeDeps({
      bnf: {
        resolveIsbn: vi.fn(async () => ({
          title: "Père & fils. 4",
          seriesName: "Père & fils",
          issueNumber: "4",
          authors: "Tagawa, Mi",
          publisher: "Ki-oon",
          pageCount: 206,
        })),
      },
      googleBooks: {
        resolveIsbn: vi.fn(async () => ({
          title: "Père et fils",
          authors: "Mi Tagawa",
          publisher: "Ki-oon",
          pageCount: 206,
          coverUrl: "https://books.google.com/cover.jpg",
          categories: null,
          volumeId: "abc",
        })),
      },
    });
    const result = await resolveScannedCode("9791032700327", deps);

    expect(result).toMatchObject({
      kind: "resolved",
      book: {
        source: "bnf",
        suggestedCategory: "manga", // l'éditeur Ki-oon (specs §5.5)
        coverUrl: "https://books.google.com/cover.jpg", // la BnF n'illustre pas
      },
    });
    expect(deps.cache.set).toHaveBeenCalledWith(expect.objectContaining({ barcode: "9791032700327", source: "bnf" }));
  });

  it("un roman étranger tombe jusqu'à Google Books", async () => {
    const deps = fakeDeps({
      googleBooks: {
        resolveIsbn: vi.fn(async () => ({
          title: "The Martian",
          authors: "Andy Weir",
          publisher: "Crown",
          pageCount: 369,
          coverUrl: null,
          categories: ["Fiction"],
          volumeId: "martian",
        })),
      },
    });
    const result = await resolveScannedCode("9780804139021", deps);

    expect(result).toMatchObject({
      kind: "resolved",
      book: { source: "google_books", suggestedCategory: "roman" },
    });
    expect(deps.cache.set).toHaveBeenCalledWith(expect.objectContaining({ source: "google_books" }));
  });

  it("toutes les sources muettes → not-found (l'UI enchaîne sur la saisie manuelle)", async () => {
    expect(await resolveScannedCode("9799999999990", fakeDeps())).toEqual({ kind: "not-found" });
  });

  it("une source qui JETTE ne casse rien : on descend d'un cran (dégradation douce, §8)", async () => {
    const deps = fakeDeps({
      gcd: { findIssuesByIsbn: vi.fn(async () => Promise.reject(new Error("base indisponible"))) },
      bnf: { resolveIsbn: vi.fn(async () => Promise.reject(new Error("BnF en rade"))) },
      googleBooks: {
        resolveIsbn: vi.fn(async () => ({
          title: "Filet",
          authors: null,
          publisher: null,
          pageCount: null,
          coverUrl: null,
          categories: ["Fiction"],
          volumeId: "safety-net",
        })),
      },
    });
    const result = await resolveScannedCode("9782000000006", deps);
    expect(result).toMatchObject({ kind: "resolved", book: { source: "google_books" } });
  });
});

describe("la cascade UPC (GCD exact → préfixe → Metron)", () => {
  it("un code complet résout l'issue exacte, zéro question, avec la couverture Metron", async () => {
    const deps = fakeDeps({
      gcd: {
        findIssuesByBarcode: vi.fn(async () => [gcdIssue()]),
        getSeriesByIds: vi.fn(async () => new Map([[42, gcdSeries()]])),
      },
      metron: {
        findIssueByGcdId: vi.fn(async () => ({
          metronId: 5,
          issueName: "Nightwing (2016) #123",
          seriesName: "Nightwing",
          number: "123",
          coverUrl: "https://static.metron.cloud/nightwing.jpg",
          seriesType: "Single Issue",
          publisher: "DC",
          pageCount: 32,
        })),
      },
    });
    const result = await resolveScannedCode("76194134174312311", deps);

    expect(result).toMatchObject({
      kind: "resolved",
      book: { suggestedCategory: "issue", source: "gcd", coverUrl: "https://static.metron.cloud/nightwing.jpg" },
    });
  });

  it("un préfixe net rend « quel numéro ? » : les issues de la série, triées", async () => {
    const deps = fakeDeps({
      gcd: {
        findIssuesByPrefix: vi.fn(async () => [
          gcdIssue({ gcdId: 3, number: "125" }),
          gcdIssue({ gcdId: 1, number: "123" }),
          gcdIssue({ gcdId: 2, number: "124" }),
        ]),
        getSeriesByIds: vi.fn(async () => new Map([[42, gcdSeries()]])),
      },
    });
    const result = await resolveScannedCode("761941341743", deps);

    expect(result).toMatchObject({ kind: "pick-issue", seriesName: "Nightwing" });
    if (result.kind === "pick-issue") {
      expect(result.issues.map((issue) => issue.number)).toEqual(["123", "124", "125"]);
    }
  });

  it("les variantes de couverture sont dédupliquées : un numéro = une ligne, la principale gagne", async () => {
    // Le cas vécu (Alias: Red Band) : GCD indexe chaque variante comme une
    // ligne — sans déduplication, « quel numéro ? » affichait six fois le #1.
    const deps = fakeDeps({
      gcd: {
        findIssuesByPrefix: vi.fn(async () => [
          gcdIssue({ gcdId: 11, number: "1", barcode: "76194134174300121" }), // variante (cover 2)
          gcdIssue({ gcdId: 10, number: "1", barcode: "76194134174300111" }), // principale
          gcdIssue({ gcdId: 12, number: "1", barcode: "76194134174300131" }), // variante (cover 3)
          gcdIssue({ gcdId: 20, number: "2", barcode: "76194134174300211" }),
        ]),
        getSeriesByIds: vi.fn(async () => new Map([[42, gcdSeries()]])),
      },
    });
    const result = await resolveScannedCode("761941341743", deps);

    expect(result.kind).toBe("pick-issue");
    if (result.kind === "pick-issue") {
      expect(result.issues.map((issue) => issue.number)).toEqual(["1", "2"]);
      // Le représentant du #1 est la couverture principale (…00111) : gcd_id 10.
      expect(result.issues[0].gcdId).toBe(10);
    }
  });

  it("un préfixe partagé rend la liste courte des séries possibles", async () => {
    const deps = fakeDeps({
      gcd: {
        findIssuesByPrefix: vi.fn(async () => [
          gcdIssue({ gcdId: 1, seriesId: 42 }),
          gcdIssue({ gcdId: 2, seriesId: 43 }),
        ]),
        getSeriesByIds: vi.fn(
          async () =>
            new Map([
              [42, gcdSeries()],
              [43, gcdSeries({ id: 43, name: "Rick and Morty Presents" })],
            ]),
        ),
      },
    });
    const result = await resolveScannedCode("761941341743", deps);

    expect(result.kind).toBe("pick-series");
    if (result.kind === "pick-series") {
      expect(result.candidates).toHaveLength(2);
      // Chaque candidate embarque ses issues : le second tap n'appelle personne.
      expect(result.candidates[0].issues).toHaveLength(1);
    }
  });

  it("une nouveauté absente du dump est identifiée par Metron et mise en cache pour toujours", async () => {
    const deps = fakeDeps({
      metron: {
        findIssueByUpc: vi.fn(async () => ({
          metronId: 77,
          issueName: "Absolute Batman (2024) #1",
          seriesName: "Absolute Batman",
          number: "1",
          coverUrl: "https://static.metron.cloud/ab1.jpg",
          seriesType: "Single Issue",
          publisher: "DC",
          pageCount: 48,
        })),
      },
    });
    const result = await resolveScannedCode("76194138800000111", deps);

    expect(result).toMatchObject({ kind: "resolved", book: { source: "metron", suggestedCategory: "issue" } });
    expect(deps.cache.set).toHaveBeenCalledWith(expect.objectContaining({ source: "metron" }));
  });

  it("le cache court-circuite tout : aucun provider appelé au deuxième scan", async () => {
    const deps = fakeDeps({
      cache: {
        get: vi.fn(async () => ({
          barcode: "76194134174312311",
          title: "Nightwing (2016) #123",
          seriesName: "Nightwing",
          issueNumber: "123",
          authors: null,
          publisher: "DC",
          pageCount: 32,
          coverUrl: "https://static.metron.cloud/nightwing.jpg",
          source: "metron" as const,
          sourceId: "5",
        })),
      },
    });
    const result = await resolveScannedCode("76194134174312311", deps);

    expect(result).toMatchObject({ kind: "resolved", book: { source: "metron" } });
    expect(deps.gcd.findIssuesByBarcode).not.toHaveBeenCalled();
    expect(deps.metron.findIssueByUpc).not.toHaveBeenCalled();
  });
});
