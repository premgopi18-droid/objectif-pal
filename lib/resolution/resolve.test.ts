import { describe, expect, it, vi } from "vitest";
import type { GcdIssue, GcdSeries } from "./providers/gcd";
import { findReplacementCover, resolveScannedCode, type ResolutionDeps } from "./resolve";
import { ProviderUnavailableError } from "./types";

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
  openLibrary?: Partial<ResolutionDeps["openLibrary"]>;
  inventaire?: Partial<ResolutionDeps["inventaire"]>;
  bnfCovers?: Partial<ResolutionDeps["bnfCovers"]>;
  epagine?: Partial<ResolutionDeps["epagine"]>;
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
    openLibrary: { findCoverByIsbn: vi.fn(async () => null), ...overrides.openLibrary },
    inventaire: { findCoverByIsbn: vi.fn(async () => null), ...overrides.inventaire },
    bnfCovers: { findCoverByIsbn: vi.fn(async () => null), ...overrides.bnfCovers },
    epagine: { findCoverByIsbn: vi.fn(async () => null), ...overrides.epagine },
    metron: {
      findIssueByGcdId: vi.fn(async () => null),
      findIssueByUpc: vi.fn(async () => null),
      ...overrides.metron,
    },
    cache: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
      stampCoverChecked: vi.fn(async () => {}),
      getMiss: vi.fn(async () => null),
      setMiss: vi.fn(async () => {}),
      ...overrides.cache,
    },
  };
}

describe("la cascade ISBN (GCD → BnF → Google Books)", () => {
  it("une BD franco-belge se résout en base, catégorie bd — et le balayage couverture PROPRE mais vide est tamponné (#176)", async () => {
    const deps = fakeDeps({
      gcd: {
        findIssuesByIsbn: vi.fn(async () => [gcdIssue({ isbn: "9782203001114", barcode: null, title: "Tintin et les Picaros" })]),
        getSeriesByIds: vi.fn(async () => new Map([[42, gcdSeries({ name: "Les Aventures de Tintin", publisher: "Casterman", languageId: 34 })]])),
      },
    });
    const result = await resolveScannedCode("9782203001114", deps);

    // Avant #176 : jamais cachée (« un raté transitoire ne doit pas figer »).
    // Désormais : un verdict PROPRE « pas de couverture » se mémorise avec
    // cover_checked_at — le rescan ne re-paie la chaîne qu'à l'expiration.
    expect(deps.cache.set).toHaveBeenCalledWith(
      expect.objectContaining({ source: "gcd", coverUrl: null, coverCheckedAt: expect.any(String) }),
    );
    expect(result).toMatchObject({
      kind: "resolved",
      book: { suggestedCategory: "bd", source: "gcd", seriesName: "Les Aventures de Tintin" },
    });
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
    // L'enrichissement Metron a coûté du réseau : il part dans barcode_cache
    // sous la source gcd — le rescan ne repaiera pas ces appels (specs §8).
    expect(deps.cache.set).toHaveBeenCalledWith(
      expect.objectContaining({ barcode: "9781302915704", source: "gcd", coverUrl: "https://static.metron.cloud/cover.jpg" }),
    );
  });

  it("le marqueur GCD « [nn] » (sans numéro, #58) devient une absence à la résolution", async () => {
    const deps = fakeDeps({
      gcd: {
        findIssuesByIsbn: vi.fn(async () => [gcdIssue({ isbn: "9781779527189", barcode: null, number: "[nn]" })]),
        getSeriesByIds: vi.fn(async () => new Map([[42, gcdSeries({ name: "Supergirl: Woman of Tomorrow" })]])),
      },
    });
    const result = await resolveScannedCode("9781779527189", deps);

    if (result.kind !== "resolved") throw new Error("attendu : resolved");
    expect(result.book.issueNumber).toBeNull();
    expect(result.book.seriesName).toBe("Supergirl: Woman of Tomorrow");
  });

  it("la clé de cache d'un ISBN est l'EAN-13 : le supplément prix ne crée pas de seconde entrée", async () => {
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
    // Scanné AVEC le supplément prix (18 chiffres) : lecture ET écriture du
    // cache se font sur l'EAN-13 seul — le prix est jeté (specs §5.1).
    const result = await resolveScannedCode("978080413902151095", deps);

    expect(result).toMatchObject({ kind: "resolved", book: { source: "google_books" } });
    expect(deps.cache.get).toHaveBeenCalledWith("9780804139021");
    expect(deps.cache.set).toHaveBeenCalledWith(expect.objectContaining({ barcode: "9780804139021" }));
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

  it("Google Books sans image : OpenLibrary comble, dans l'ordre, et le résultat part en cache", async () => {
    // Le cas VF courant (mesuré §5.4) : la fiche existe, l'imageLinks manque.
    const deps = fakeDeps({
      bnf: {
        resolveIsbn: vi.fn(async () => ({
          title: "Radiant T1",
          seriesName: "Radiant",
          issueNumber: "1",
          authors: "Tony Valente",
          publisher: "Ankama",
          pageCount: 176,
        })),
      },
      openLibrary: { findCoverByIsbn: vi.fn(async () => "https://covers.openlibrary.org/b/isbn/9791033500063-L.jpg") },
      inventaire: { findCoverByIsbn: vi.fn(async () => "https://inventaire.io/img/entities/abc") },
    });
    const result = await resolveScannedCode("9791033500063", deps);
    if (result.kind !== "resolved") throw new Error("attendu : resolved");
    expect(result.book.coverUrl).toBe("https://covers.openlibrary.org/b/isbn/9791033500063-L.jpg");
    // OpenLibrary a répondu : Inventaire n'est JAMAIS appelé (pas d'appel inutile).
    expect(deps.inventaire.findCoverByIsbn).not.toHaveBeenCalled();
    expect(deps.cache.set).toHaveBeenCalledWith(
      expect.objectContaining({ coverUrl: "https://covers.openlibrary.org/b/isbn/9791033500063-L.jpg" }),
    );
  });

  it("OpenLibrary muet : Inventaire prend le relais, et les crans suivants ne sont pas appelés", async () => {
    const deps = fakeDeps({
      bnf: { resolveIsbn: vi.fn(async () => ({ title: "Un roman", seriesName: null, issueNumber: null, authors: null, publisher: null, pageCount: null })) },
      inventaire: { findCoverByIsbn: vi.fn(async () => "https://inventaire.io/img/entities/def") },
    });
    const result = await resolveScannedCode("9782070360024", deps);
    if (result.kind !== "resolved") throw new Error("attendu : resolved");
    expect(result.book.coverUrl).toBe("https://inventaire.io/img/entities/def");
    expect(deps.bnfCovers.findCoverByIsbn).not.toHaveBeenCalled();
    expect(deps.epagine.findCoverByIsbn).not.toHaveBeenCalled();
  });

  it("le trou VF type Urban Comics : tout est muet jusqu'à epagine, dernier repli avant la photo", async () => {
    // Le cas mesuré du 19/07/2026 (Batman : La Cour des Hiboux, 9791026820963) :
    // fiche Google Books sans image, ISBN inconnu d'OpenLibrary, d'Inventaire
    // et du Service Couvertures BnF — seul le CDN des libraires l'a.
    const deps = fakeDeps({
      bnf: { resolveIsbn: vi.fn(async () => ({ title: "Batman", seriesName: null, issueNumber: null, authors: "Scott Snyder", publisher: "Urban comics", pageCount: 176 })) },
      epagine: { findCoverByIsbn: vi.fn(async () => "https://images.epagine.fr/963/9791026820963_1_75.jpg") },
    });
    const result = await resolveScannedCode("9791026820963", deps);
    if (result.kind !== "resolved") throw new Error("attendu : resolved");
    expect(result.book.coverUrl).toBe("https://images.epagine.fr/963/9791026820963_1_75.jpg");
    // L'ordre est respecté : epagine n'est sollicité qu'après les trois crans ouverts.
    expect(deps.openLibrary.findCoverByIsbn).toHaveBeenCalled();
    expect(deps.inventaire.findCoverByIsbn).toHaveBeenCalled();
    expect(deps.bnfCovers.findCoverByIsbn).toHaveBeenCalled();
  });

  it("BnF Couvertures comble avant epagine quand il a l'image", async () => {
    const deps = fakeDeps({
      bnf: { resolveIsbn: vi.fn(async () => ({ title: "Un roman", seriesName: null, issueNumber: null, authors: null, publisher: null, pageCount: null })) },
      bnfCovers: {
        findCoverByIsbn: vi.fn(
          async () =>
            "https://openapi.bnf.fr/couverture/image/image/recupererImage?ISBN=9782226250223&couverture=1&taille=originale",
        ),
      },
    });
    const result = await resolveScannedCode("9782226250223", deps);
    if (result.kind !== "resolved") throw new Error("attendu : resolved");
    expect(result.book.coverUrl).toContain("openapi.bnf.fr");
    expect(deps.epagine.findCoverByIsbn).not.toHaveBeenCalled();
  });

  it("Google Books a l'image : aucun repli appelé (zéro coût sur le chemin heureux)", async () => {
    const deps = fakeDeps({
      googleBooks: {
        resolveIsbn: vi.fn(async () => ({
          title: "Dune",
          authors: null,
          publisher: null,
          pageCount: null,
          coverUrl: "https://books.google.com/dune.jpg",
          categories: null,
          volumeId: "vol-1",
        })),
      },
    });
    const result = await resolveScannedCode("9780441013593", deps);
    if (result.kind !== "resolved") throw new Error("attendu : resolved");
    expect(result.book.coverUrl).toBe("https://books.google.com/dune.jpg");
    expect(deps.openLibrary.findCoverByIsbn).not.toHaveBeenCalled();
    expect(deps.inventaire.findCoverByIsbn).not.toHaveBeenCalled();
    expect(deps.bnfCovers.findCoverByIsbn).not.toHaveBeenCalled();
    expect(deps.epagine.findCoverByIsbn).not.toHaveBeenCalled();
  });

  it("un TPB VO que Metron n'illustre pas retombe sur la chaîne ISBN", async () => {
    const deps = fakeDeps({
      gcd: {
        findIssuesByIsbn: vi.fn(async () => [gcdIssue({ isbn: "9781302915704", barcode: null, seriesId: 42 })]),
        getSeriesByIds: vi.fn(async () => new Map([[42, gcdSeries()]])),
      },
      openLibrary: { findCoverByIsbn: vi.fn(async () => "https://covers.openlibrary.org/b/isbn/9781302915704-L.jpg") },
    });
    const result = await resolveScannedCode("9781302915704", deps);
    if (result.kind !== "resolved") throw new Error("attendu : resolved");
    expect(result.book.coverUrl).toBe("https://covers.openlibrary.org/b/isbn/9781302915704-L.jpg");
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
    expect(await resolveScannedCode("9799999999990", fakeDeps())).toEqual({ kind: "not-found", coverUrl: null });
  });

  it("identification ratée partout mais couverture chez les libraires : not-found AVEC l'image (#55)", async () => {
    // Le cas mesuré du 19/07/2026 : HEROICS (Northstar Comics, auto-édité,
    // 9782955689851) — inconnu de GCD, de la BnF et de Google Books, mais
    // epagine a la couverture. Elle pré-remplit la saisie manuelle.
    const deps = fakeDeps({
      epagine: { findCoverByIsbn: vi.fn(async () => "https://images.epagine.fr/851/9782955689851_1_75.jpg") },
    });
    const result = await resolveScannedCode("9782955689851", deps);

    expect(result).toEqual({ kind: "not-found", coverUrl: "https://images.epagine.fr/851/9782955689851_1_75.jpg" });
  });

  it("budget global épuisé : on n'essaie plus les providers restants, on rend not-found", async () => {
    vi.useFakeTimers();
    try {
      const deps = fakeDeps({
        // La BnF « prend » 11 s (on avance l'horloge) : le budget de la
        // cascade est dépassé — Google Books ne doit plus être tenté.
        bnf: {
          resolveIsbn: vi.fn(async () => {
            vi.advanceTimersByTime(11_000);
            return null;
          }),
        },
        googleBooks: { resolveIsbn: vi.fn(async () => null) },
      });
      const result = await resolveScannedCode("9780804139021", deps);

      // Budget dépassé : la chaîne couverture du not-found (#55) rend null
      // immédiatement, elle aussi — aucun provider couverture n'est tenté.
      expect(result).toEqual({ kind: "not-found", coverUrl: null });
      expect(deps.bnf.resolveIsbn).toHaveBeenCalled();
      expect(deps.googleBooks.resolveIsbn).not.toHaveBeenCalled();
      expect(deps.openLibrary.findCoverByIsbn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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
    // L'enrichissement Metron est caché sous le code BRUT : sur un UPC, le
    // supplément est signifiant (numéro, couverture, tirage — specs §5.1).
    expect(deps.cache.set).toHaveBeenCalledWith(expect.objectContaining({ barcode: "76194134174312311", source: "gcd" }));
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

  it("un code COMPLET absent de GCD va chez Metron AVANT les listes par préfixe", async () => {
    // Le cas vécu (It's In Your Skin #1) : GCD n'a pas le code exact mais
    // connaît le préfixe — partagé par d'autres séries qui n'ont pas ce numéro.
    // Metron, lui, a le code complet : c'est lui qui doit répondre.
    const deps = fakeDeps({
      gcd: {
        findIssuesByPrefix: vi.fn(async () => [gcdIssue({ gcdId: 500, number: "43" }), gcdIssue({ gcdId: 501, number: "44", seriesId: 43 })]),
        getSeriesByIds: vi.fn(async () => new Map([[42, gcdSeries()]])),
      },
      metron: {
        findIssueByUpc: vi.fn(async () => ({
          metronId: 321,
          issueName: "It's In Your Skin (2025) #1",
          seriesName: "It's In Your Skin",
          number: "1",
          coverUrl: "https://static.metron.cloud/skin1.jpg",
          seriesType: "Limited Series",
          publisher: "Mad Cave",
          pageCount: 28,
        })),
      },
    });
    const result = await resolveScannedCode("70985304605900111", deps);

    expect(result).toMatchObject({
      kind: "resolved",
      book: { source: "metron", issueNumber: "1", suggestedCategory: "issue" },
    });
    // Le préfixe n'a même pas été consulté : le code complet prime.
    expect(deps.gcd.findIssuesByPrefix).not.toHaveBeenCalled();
    expect(deps.cache.set).toHaveBeenCalledWith(expect.objectContaining({ source: "metron" }));
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

  it("une entrée ISBN cachée SANS couverture retente la chaîne et répare l'entrée", async () => {
    // Le cas Batman (9791026820963) : identifié par la BnF avant l'arrivée des
    // crans BnF Couvertures/epagine, donc figé en cache sans image. Le rescan
    // doit récupérer la couverture ET la persister.
    const deps = fakeDeps({
      cache: {
        get: vi.fn(async () => ({
          barcode: "9791026820963",
          title: "Batman",
          seriesName: null,
          issueNumber: null,
          authors: "Scott Snyder",
          publisher: "Urban comics",
          pageCount: 176,
          coverUrl: null,
          source: "bnf" as const,
          sourceId: "9791026820963",
        })),
      },
      epagine: { findCoverByIsbn: vi.fn(async () => "https://images.epagine.fr/963/9791026820963_1_75.jpg") },
    });
    const result = await resolveScannedCode("9791026820963", deps);

    if (result.kind !== "resolved") throw new Error("attendu : resolved");
    expect(result.book.coverUrl).toBe("https://images.epagine.fr/963/9791026820963_1_75.jpg");
    // L'entrée est réparée, même source, la couverture en plus.
    expect(deps.cache.set).toHaveBeenCalledWith(
      expect.objectContaining({ barcode: "9791026820963", source: "bnf", coverUrl: "https://images.epagine.fr/963/9791026820963_1_75.jpg" }),
    );
    // L'identification n'est PAS repayée : seuls les crans couverture tournent.
    expect(deps.bnf.resolveIsbn).not.toHaveBeenCalled();
    expect(deps.gcd.findIssuesByIsbn).not.toHaveBeenCalled();
  });

  it("le retenter d'une entrée sans couverture qui ne rapporte rien ne réécrit pas le cache", async () => {
    const deps = fakeDeps({
      cache: {
        get: vi.fn(async () => ({
          barcode: "9791026820963",
          title: "Batman",
          seriesName: null,
          issueNumber: null,
          authors: null,
          publisher: "Urban comics",
          pageCount: 176,
          coverUrl: null,
          source: "bnf" as const,
          sourceId: "9791026820963",
        })),
      },
    });
    const result = await resolveScannedCode("9791026820963", deps);

    if (result.kind !== "resolved") throw new Error("attendu : resolved");
    expect(result.book.coverUrl).toBeNull();
    expect(deps.cache.set).not.toHaveBeenCalled();
  });

  it("une entrée ISBN cachée AVEC couverture ne retente rien (zéro coût au rescan)", async () => {
    const deps = fakeDeps({
      cache: {
        get: vi.fn(async () => ({
          barcode: "9780804139021",
          title: "The Martian",
          seriesName: null,
          issueNumber: null,
          authors: "Andy Weir",
          publisher: "Crown",
          pageCount: 369,
          coverUrl: "https://books.google.com/martian.jpg",
          source: "google_books" as const,
          sourceId: "martian",
        })),
      },
    });
    const result = await resolveScannedCode("9780804139021", deps);

    if (result.kind !== "resolved") throw new Error("attendu : resolved");
    expect(result.book.coverUrl).toBe("https://books.google.com/martian.jpg");
    expect(deps.googleBooks.resolveIsbn).not.toHaveBeenCalled();
    expect(deps.epagine.findCoverByIsbn).not.toHaveBeenCalled();
    expect(deps.cache.set).not.toHaveBeenCalled();
  });

  it("une saisie manuelle cachée (#55) se résout comme n'importe quelle entrée : zéro question au rescan", async () => {
    const deps = fakeDeps({
      cache: {
        get: vi.fn(async () => ({
          barcode: "9782955689851",
          title: "HEROICS – Season 1: Fathers",
          seriesName: "HEROICS",
          issueNumber: "1",
          authors: "Maxime Garbarini",
          publisher: "Northstar Comics",
          pageCount: null,
          coverUrl: "https://images.epagine.fr/851/9782955689851_1_75.jpg",
          source: "manual" as const,
          sourceId: null,
        })),
      },
    });
    const result = await resolveScannedCode("9782955689851", deps);

    expect(result).toMatchObject({
      kind: "resolved",
      book: { source: "manual", title: "HEROICS – Season 1: Fathers", coverUrl: "https://images.epagine.fr/851/9782955689851_1_75.jpg" },
    });
    // Entrée complète (couverture incluse) : aucune source n'est re-payée.
    expect(deps.gcd.findIssuesByIsbn).not.toHaveBeenCalled();
    expect(deps.bnf.resolveIsbn).not.toHaveBeenCalled();
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

describe("la re-résolution de couverture pour la réparation des liens cassés (#53)", () => {
  it("un ISBN repasse par Google Books puis les replis, dans l'ordre", async () => {
    const deps = fakeDeps({
      inventaire: { findCoverByIsbn: vi.fn(async () => "https://inventaire.io/img/entities/abc") },
    });
    const cover = await findReplacementCover({ barcodeType: "isbn", isbn: "9791026820963", barcode: null }, deps);

    expect(cover).toBe("https://inventaire.io/img/entities/abc");
    expect(deps.googleBooks.resolveIsbn).toHaveBeenCalledWith("9791026820963");
    expect(deps.openLibrary.findCoverByIsbn).toHaveBeenCalled();
  });

  it("un UPC repasse par Metron (la source des couvertures VO)", async () => {
    const deps = fakeDeps({
      metron: {
        findIssueByUpc: vi.fn(async () => ({
          metronId: 99,
          issueName: null,
          seriesName: "Nightwing",
          number: "123",
          coverUrl: "https://static.metron.cloud/nightwing.jpg",
          seriesType: null,
          publisher: "DC",
          pageCount: 32,
        })),
      },
    });
    const cover = await findReplacementCover({ barcodeType: "upc", isbn: null, barcode: "76194134174312311" }, deps);

    expect(cover).toBe("https://static.metron.cloud/nightwing.jpg");
  });

  it("toutes les sources muettes, ou un livre sans code : null — la décision tranchera (garder ou vider)", async () => {
    expect(await findReplacementCover({ barcodeType: "isbn", isbn: "9799999999990", barcode: null }, fakeDeps())).toBeNull();
    expect(await findReplacementCover({ barcodeType: "isbn", isbn: null, barcode: null }, fakeDeps())).toBeNull();
  });

  it("une source qui jette n'empêche pas les replis suivants (mêmes amortisseurs que la cascade)", async () => {
    const deps = fakeDeps({
      googleBooks: { resolveIsbn: vi.fn(async () => Promise.reject(new Error("GB en rade"))) },
      epagine: { findCoverByIsbn: vi.fn(async () => "https://images.epagine.fr/963/9791026820963_1_75.jpg") },
    });
    const cover = await findReplacementCover({ barcodeType: "isbn", isbn: "9791026820963", barcode: null }, deps);

    expect(cover).toBe("https://images.epagine.fr/963/9791026820963_1_75.jpg");
  });
});

/**
 * Le cache négatif et la santé de la cascade (#175/#176) : un « introuvable »
 * ne coûte plus la chaîne complète à chaque scan — mais SEULEMENT sur un
 * verdict propre. Panne ≠ absence : une source indisponible (quota global
 * épuisé, 429, timeout) interdit toute écriture négative.
 */
describe("le cache négatif (#176) et la santé de la cascade (#175)", () => {
  const freshTimestamp = () => new Date(Date.now() - 60_000).toISOString();
  const staleTimestamp = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

  it("un introuvable PROPRE écrit le cache négatif, avec l'image des libraires", async () => {
    const deps = fakeDeps({
      epagine: { findCoverByIsbn: vi.fn(async () => "https://images.epagine.fr/851/9782955689851_1_75.jpg") },
    });
    const result = await resolveScannedCode("9782955689851", deps);

    expect(result).toEqual({ kind: "not-found", coverUrl: "https://images.epagine.fr/851/9782955689851_1_75.jpg" });
    expect(deps.cache.setMiss).toHaveBeenCalledWith("9782955689851", "https://images.epagine.fr/851/9782955689851_1_75.jpg");
  });

  it("une source INDISPONIBLE (quota/429) n'écrit JAMAIS le cache négatif", async () => {
    const deps = fakeDeps({
      googleBooks: {
        resolveIsbn: vi.fn(async () => {
          throw new ProviderUnavailableError("Google Books", "quota global quotidien épuisé");
        }),
      },
    });
    const result = await resolveScannedCode("9782955689851", deps);

    expect(result).toMatchObject({ kind: "not-found" });
    expect(deps.cache.setMiss).not.toHaveBeenCalled();
  });

  it("une source qui JETTE (timeout, panne) n'écrit pas non plus — erreur ≠ absence", async () => {
    const deps = fakeDeps({
      bnf: { resolveIsbn: vi.fn(async () => Promise.reject(new Error("BnF en rade"))) },
    });
    const result = await resolveScannedCode("9782955689851", deps);

    expect(result).toMatchObject({ kind: "not-found" });
    expect(deps.cache.setMiss).not.toHaveBeenCalled();
  });

  it("un échec de la requête GCD dégrade aussi : la base est l'identifiant principal", async () => {
    const deps = fakeDeps({
      gcd: { findIssuesByIsbn: vi.fn(async () => Promise.reject(new Error("base indisponible"))) },
    });
    await resolveScannedCode("9782955689851", deps);

    expect(deps.cache.setMiss).not.toHaveBeenCalled();
  });

  it("un introuvable RÉCENT court-circuite tout : zéro provider appelé, l'image mémorisée ressort (#55)", async () => {
    const deps = fakeDeps({
      cache: {
        getMiss: vi.fn(async () => ({ coverUrl: "https://images.epagine.fr/851/x.jpg", lastCheckedAt: freshTimestamp() })),
      },
    });
    const result = await resolveScannedCode("9782955689851", deps);

    expect(result).toEqual({ kind: "not-found", coverUrl: "https://images.epagine.fr/851/x.jpg" });
    expect(deps.gcd.findIssuesByIsbn).not.toHaveBeenCalled();
    expect(deps.bnf.resolveIsbn).not.toHaveBeenCalled();
    expect(deps.googleBooks.resolveIsbn).not.toHaveBeenCalled();
    expect(deps.epagine.findCoverByIsbn).not.toHaveBeenCalled();
  });

  it("un introuvable PÉRIMÉ (> 7 j) retente la cascade complète", async () => {
    const deps = fakeDeps({
      cache: { getMiss: vi.fn(async () => ({ coverUrl: null, lastCheckedAt: staleTimestamp(8) })) },
    });
    await resolveScannedCode("9782955689851", deps);

    expect(deps.gcd.findIssuesByIsbn).toHaveBeenCalled();
    expect(deps.bnf.resolveIsbn).toHaveBeenCalled();
  });

  it("une entrée cachée sans couverture, tamponnée récemment, ne retente RIEN (zéro coût au rescan)", async () => {
    const deps = fakeDeps({
      cache: {
        get: vi.fn(async () => ({
          barcode: "9791026820963",
          title: "Batman",
          seriesName: null,
          issueNumber: null,
          authors: null,
          publisher: "Urban comics",
          pageCount: 176,
          coverUrl: null,
          source: "bnf" as const,
          sourceId: "9791026820963",
          coverCheckedAt: freshTimestamp(),
        })),
      },
    });
    const result = await resolveScannedCode("9791026820963", deps);

    expect(result).toMatchObject({ kind: "resolved", book: { coverUrl: null } });
    expect(deps.googleBooks.resolveIsbn).not.toHaveBeenCalled();
    expect(deps.openLibrary.findCoverByIsbn).not.toHaveBeenCalled();
  });

  it("le retenter PROPRE qui ne rapporte rien tamponne l'entrée ; dégradé, il ne tamponne pas", async () => {
    const cachedEntry = {
      barcode: "9791026820963",
      title: "Batman",
      seriesName: null,
      issueNumber: null,
      authors: null,
      publisher: "Urban comics",
      pageCount: 176,
      coverUrl: null,
      source: "bnf" as const,
      sourceId: "9791026820963",
      coverCheckedAt: staleTimestamp(31),
    };
    // Balayage propre : tampon posé.
    const clean = fakeDeps({ cache: { get: vi.fn(async () => cachedEntry) } });
    await resolveScannedCode("9791026820963", clean);
    expect(clean.cache.stampCoverChecked).toHaveBeenCalledWith("9791026820963");

    // Balayage dégradé (quota épuisé) : pas de tampon, on retentera.
    const degraded = fakeDeps({
      cache: { get: vi.fn(async () => cachedEntry) },
      googleBooks: {
        resolveIsbn: vi.fn(async () => {
          throw new ProviderUnavailableError("Google Books", "quota global quotidien épuisé");
        }),
      },
    });
    await resolveScannedCode("9791026820963", degraded);
    expect(degraded.cache.stampCoverChecked).not.toHaveBeenCalled();
  });

  it("un UPC introuvable propre écrit le cache négatif ; un récent court-circuite Metron", async () => {
    const clean = fakeDeps();
    await resolveScannedCode("761941341743", clean);
    expect(clean.cache.setMiss).toHaveBeenCalledWith("761941341743", null);

    const shortCircuit = fakeDeps({
      cache: { getMiss: vi.fn(async () => ({ coverUrl: null, lastCheckedAt: freshTimestamp() })) },
    });
    const result = await resolveScannedCode("761941341743", shortCircuit);
    expect(result).toEqual({ kind: "not-found", coverUrl: null });
    expect(shortCircuit.gcd.findIssuesByBarcode).not.toHaveBeenCalled();
    expect(shortCircuit.metron.findIssueByUpc).not.toHaveBeenCalled();
  });

  it("un UPC dont Metron est indisponible n'écrit pas de cache négatif", async () => {
    const deps = fakeDeps({
      metron: {
        findIssueByUpc: vi.fn(async () => {
          throw new ProviderUnavailableError("Metron", "quota global (req/min) épuisé");
        }),
      },
    });
    const result = await resolveScannedCode("761941341743", deps);

    expect(result).toEqual({ kind: "not-found", coverUrl: null });
    expect(deps.cache.setMiss).not.toHaveBeenCalled();
  });
});
