import { describe, expect, it } from "vitest";
import {
  deriveSeriesProgress,
  EMPTY_SERIES_CATALOG,
  fetchSeriesCatalog,
  MAX_TRACKED_SERIES,
  parseVolumeNumber,
  toGcdIssueId,
  type ReadVolumeFact,
  type SeriesCatalog,
} from "./series-catalog";
import type { GcdIssue, GcdProvider, GcdSeries } from "@/lib/resolution/providers/gcd";

/**
 * Le lot B du #30 — « combien de tomes lus, quel est le suivant ». La règle
 * qu'on protège ici est une règle de PRUDENCE : hors numérotation exploitable
 * de bout en bout, la dérivation doit se TAIRE. Chaque test est un cas de
 * données réel (mesurés le 19/07/2026 : 82 % de numéros numériques, 11,9 % de
 * `[nn]`, 96,1 % de séries FR à numérotation contiguë).
 */

const ASTERIX = 1001;

/** Un catalogue d'une seule série, numérotée 1..n, et les tomes lus qu'on lui relie. */
function catalogOf(numbers: string[], readGcdIds: { gcdIssueId: number; number: string }[]): SeriesCatalog {
  return {
    issues: readGcdIds.map(({ gcdIssueId, number }) => ({ gcdIssueId, seriesId: ASTERIX, number })),
    series: [{ seriesId: ASTERIX, seriesName: "Astérix (GCD)", numbers }],
  };
}

const read = (gcdIssueId: number, seriesName: string | null = "Astérix"): ReadVolumeFact => ({
  gcdIssueId,
  seriesName,
});

describe("parseVolumeNumber", () => {
  it("ne garde que les numéros purement numériques", () => {
    expect(parseVolumeNumber("12")).toBe(12);
    expect(parseVolumeNumber(" 07 ")).toBe(7);
    expect(parseVolumeNumber("[nn]")).toBeNull();
    expect(parseVolumeNumber("41 (842)")).toBeNull();
    expect(parseVolumeNumber("10/2020")).toBeNull();
    expect(parseVolumeNumber("4 Pre-Order Edition")).toBeNull();
    expect(parseVolumeNumber("12A")).toBeNull();
    expect(parseVolumeNumber("")).toBeNull();
    expect(parseVolumeNumber(null)).toBeNull();
  });
});

describe("toGcdIssueId", () => {
  it("n'accepte que la source gcd, avec un identifiant numérique", () => {
    expect(toGcdIssueId("gcd", "12345")).toBe(12345);
    expect(toGcdIssueId("gcd", null)).toBeNull();
    expect(toGcdIssueId("gcd", "martian")).toBeNull();
    // Les autres sources numérotent chez elles : jamais de croisement avec GCD.
    expect(toGcdIssueId("bnf", "9791026820963")).toBeNull();
    expect(toGcdIssueId("metron", "5")).toBeNull();
    expect(toGcdIssueId("manual", "5")).toBeNull();
  });
});

describe("deriveSeriesProgress — le cas nominal", () => {
  it("annonce le plus petit tome non lu d'une série contiguë", () => {
    const catalog = catalogOf(
      ["1", "2", "3", "4", "5"],
      [
        { gcdIssueId: 1, number: "1" },
        { gcdIssueId: 2, number: "2" },
      ],
    );
    const result = deriveSeriesProgress([read(1), read(2)], catalog, new Map([["Astérix", 2]]));

    expect(result).toEqual([
      {
        seriesId: ASTERIX,
        seriesName: "Astérix",
        volumesRead: 2,
        knownVolumes: 5,
        nextVolume: "3",
        status: "next-known",
        reason: null,
      },
    ]);
  });

  it("propose le TROU quand la lecture a sauté un tome — c'est bien le suivant à lire", () => {
    const catalog = catalogOf(
      ["1", "2", "3"],
      [
        { gcdIssueId: 1, number: "1" },
        { gcdIssueId: 3, number: "3" },
      ],
    );
    const result = deriveSeriesProgress([read(1), read(3)], catalog, new Map([["Astérix", 2]]));

    expect(result[0].nextVolume).toBe("2");
    expect(result[0].status).toBe("next-known");
  });

  it("reprend le nom AFFICHÉ par l'app, pas celui de GCD", () => {
    const catalog = catalogOf(["1", "2"], [{ gcdIssueId: 1, number: "1" }]);
    const result = deriveSeriesProgress([read(1, "Astérix")], catalog, new Map([["Astérix", 1]]));
    expect(result[0].seriesName).toBe("Astérix");
  });

  it("retombe sur le nom GCD quand le livre n'en porte pas", () => {
    const catalog = catalogOf(["1", "2"], [{ gcdIssueId: 1, number: "1" }]);
    const result = deriveSeriesProgress([read(1, null)], catalog, new Map());
    expect(result[0].seriesName).toBe("Astérix (GCD)");
    // Aucun nom au compteur du moteur : on retombe sur les livres reliés.
    expect(result[0].volumesRead).toBe(1);
  });

  it("réutilise le compte de tomes lus du moteur, jamais un recompte local", () => {
    const catalog = catalogOf(["1", "2", "3"], [{ gcdIssueId: 1, number: "1" }]);
    // Deux tomes lus selon le moteur, un seul relié à GCD → on ne devine pas.
    const result = deriveSeriesProgress([read(1)], catalog, new Map([["Astérix", 2]]));
    expect(result[0].volumesRead).toBe(2);
    expect(result[0].status).toBe("unusable");
    expect(result[0].reason).toBe("partial-link");
  });
});

describe("deriveSeriesProgress — série complète", () => {
  it("dit « à jour » quand tout le catalogue est lu", () => {
    const catalog = catalogOf(
      ["1", "2"],
      [
        { gcdIssueId: 1, number: "1" },
        { gcdIssueId: 2, number: "2" },
      ],
    );
    const result = deriveSeriesProgress([read(1), read(2)], catalog, new Map([["Astérix", 2]]));
    expect(result[0].status).toBe("no-next-known");
    expect(result[0].nextVolume).toBeNull();
  });
});

describe("deriveSeriesProgress — les silences", () => {
  it("se tait sur une numérotation trouée (notre import est réduit : le trou peut nous manquer)", () => {
    const catalog = catalogOf(["1", "2", "7"], [{ gcdIssueId: 1, number: "1" }]);
    const result = deriveSeriesProgress([read(1)], catalog, new Map([["Astérix", 1]]));
    expect(result[0]).toMatchObject({ status: "unusable", reason: "holey-numbering", nextVolume: null });
    expect(result[0].knownVolumes).toBe(3);
  });

  it("se tait sur une série sans aucun numéro exploitable", () => {
    const catalog = catalogOf(["[nn]", "41 (842)"], [{ gcdIssueId: 1, number: "[nn]" }]);
    const result = deriveSeriesProgress([read(1)], catalog, new Map([["Astérix", 1]]));
    expect(result[0]).toMatchObject({ status: "unusable", reason: "no-numbering", knownVolumes: 0 });
  });

  it("se tait quand le tome LU n'est pas numéroté, même si la série l'est", () => {
    const catalog = catalogOf(["1", "2", "3"], [{ gcdIssueId: 9, number: "[nn]" }]);
    const result = deriveSeriesProgress([read(9)], catalog, new Map([["Astérix", 1]]));
    expect(result[0]).toMatchObject({ status: "unusable", reason: "partial-link" });
  });

  it("se tait quand deux livres lus portent le même numéro (variantes)", () => {
    const catalog = catalogOf(
      ["1", "2", "3"],
      [
        { gcdIssueId: 1, number: "1" },
        { gcdIssueId: 2, number: "1" },
      ],
    );
    const result = deriveSeriesProgress([read(1), read(2)], catalog, new Map([["Astérix", 2]]));
    expect(result[0]).toMatchObject({ status: "unusable", reason: "partial-link" });
  });

  it("ignore une série inconnue de GCD plutôt que d'inventer une ligne", () => {
    const result = deriveSeriesProgress([read(404)], EMPTY_SERIES_CATALOG, new Map([["Astérix", 1]]));
    expect(result).toEqual([]);
  });

  it("rend une liste vide quand aucune série n'est commencée", () => {
    expect(deriveSeriesProgress([], EMPTY_SERIES_CATALOG, new Map())).toEqual([]);
  });
});

describe("deriveSeriesProgress — le tri", () => {
  it("classe par tomes lus décroissants, puis par nom", () => {
    const catalog: SeriesCatalog = {
      issues: [
        { gcdIssueId: 1, seriesId: 1, number: "1" },
        { gcdIssueId: 2, seriesId: 1, number: "2" },
        { gcdIssueId: 3, seriesId: 2, number: "1" },
        { gcdIssueId: 4, seriesId: 3, number: "1" },
      ],
      series: [
        { seriesId: 1, seriesName: null, numbers: ["1", "2", "3"] },
        { seriesId: 2, seriesName: null, numbers: ["1", "2"] },
        { seriesId: 3, seriesName: null, numbers: ["1", "2"] },
      ],
    };
    const readVolumes = [read(1, "Blake"), read(2, "Blake"), read(3, "Zorro"), read(4, "Alix")];
    const counts = new Map([
      ["Blake", 2],
      ["Zorro", 1],
      ["Alix", 1],
    ]);

    expect(deriveSeriesProgress(readVolumes, catalog, counts).map((entry) => entry.seriesName)).toEqual([
      "Blake",
      "Alix",
      "Zorro",
    ]);
  });
});

/**
 * Le provider : ce qu'on protège, c'est la BORNITUDE — un nombre de requêtes
 * FIXE quel que soit le nombre de tomes ou de séries (jamais de N+1).
 */
describe("fetchSeriesCatalog", () => {
  function fakeProvider(issues: GcdIssue[], volumes: { seriesId: number; number: string }[]) {
    const calls = { getIssuesByGcdIds: 0, listSeriesVolumes: 0, getSeriesByIds: 0 };
    const provider = {
      async getIssuesByGcdIds(gcdIds: number[]) {
        calls.getIssuesByGcdIds += 1;
        return issues.filter((issue) => gcdIds.includes(issue.gcdId));
      },
      async listSeriesVolumes(seriesIds: number[]) {
        calls.listSeriesVolumes += 1;
        return volumes.filter((volume) => seriesIds.includes(volume.seriesId));
      },
      async getSeriesByIds(seriesIds: number[]) {
        calls.getSeriesByIds += 1;
        return new Map<number, GcdSeries>(
          seriesIds.map((id) => [id, { id, name: `Série ${id}`, format: null, publisher: null, languageId: 34 }]),
        );
      },
    } as unknown as GcdProvider;
    return { provider, calls };
  }

  const issue = (gcdId: number, seriesId: number, number: string): GcdIssue => ({
    gcdId,
    barcode: null,
    seriesId,
    number,
    pageCount: null,
    isbn: null,
    title: null,
  });

  it("ne requête rien sans aucun livre relié à GCD", async () => {
    const { provider, calls } = fakeProvider([], []);
    expect(await fetchSeriesCatalog(provider, [])).toEqual(EMPTY_SERIES_CATALOG);
    expect(calls.getIssuesByGcdIds).toBe(0);
  });

  it("charge le catalogue en un nombre FIXE de requêtes, jamais une par tome", async () => {
    const issues = Array.from({ length: 50 }, (_, index) => issue(index + 1, ASTERIX, String(index + 1)));
    const volumes = issues.map((row) => ({ seriesId: ASTERIX, number: row.number }));
    const { provider, calls } = fakeProvider(issues, volumes);

    const catalog = await fetchSeriesCatalog(
      provider,
      issues.map((row) => row.gcdId),
    );

    expect(catalog.issues).toHaveLength(50);
    expect(catalog.series).toEqual([
      { seriesId: ASTERIX, seriesName: "Série 1001", numbers: volumes.map((volume) => volume.number) },
    ]);
    // 50 tomes, 1 série → 1 + 1 + 1 requêtes. Toujours.
    expect(calls).toEqual({ getIssuesByGcdIds: 1, getSeriesByIds: 1, listSeriesVolumes: 1 });
  });

  it("groupe les séries par paquets — jamais une requête par série", async () => {
    const issues = Array.from({ length: 25 }, (_, index) => issue(index + 1, 2000 + index, "1"));
    const volumes = issues.map((row) => ({ seriesId: row.seriesId, number: "1" }));
    const { provider, calls } = fakeProvider(issues, volumes);

    const catalog = await fetchSeriesCatalog(
      provider,
      issues.map((row) => row.gcdId),
    );

    expect(catalog.series).toHaveLength(25);
    // 25 séries par paquets de 10 → 3 requêtes de numérotation, pas 25.
    expect(calls).toEqual({ getIssuesByGcdIds: 1, getSeriesByIds: 1, listSeriesVolumes: 3 });
  });

  it("plafonne le nombre de séries suivies", async () => {
    const seriesCount = MAX_TRACKED_SERIES + 5;
    const issues = Array.from({ length: seriesCount }, (_, index) => issue(index + 1, 3000 + index, "1"));
    const volumes = issues.map((row) => ({ seriesId: row.seriesId, number: "1" }));
    const { provider } = fakeProvider(issues, volumes);

    const catalog = await fetchSeriesCatalog(
      provider,
      issues.map((row) => row.gcdId),
    );

    expect(catalog.series).toHaveLength(MAX_TRACKED_SERIES);
  });

  it("dédoublonne les lignes de variantes d'un même gcd_id", async () => {
    const { provider } = fakeProvider(
      [issue(1, ASTERIX, "1"), issue(1, ASTERIX, "1")],
      [{ seriesId: ASTERIX, number: "1" }],
    );
    const catalog = await fetchSeriesCatalog(provider, [1, 1]);
    expect(catalog.issues).toEqual([{ gcdIssueId: 1, seriesId: ASTERIX, number: "1" }]);
  });
});
