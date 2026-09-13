import { describe, expect, it } from "vitest";
import {
  deriveSeries,
  deriveSeriesProgress,
  MIN_BOOKS_TO_SHOW_SERIES,
  nextInPileBookIds,
  summarizeSeries,
  type SeriesBookFact,
  type SeriesFact,
} from "./derive-series";

/**
 * Les cas du proto (`docs/protos/proto-series.html`, données SERIES) transposés
 * en tests, plus les cas limites de #291 : total déclaré inférieur au possédé,
 * indice GCD, emprunt lu, tome lu sans numéro.
 */

const series = (overrides: Partial<SeriesFact> = {}): SeriesFact => ({
  id: "s1",
  name: "Lastman",
  category: "bd",
  totalVolumes: null,
  isOngoing: false,
  factDeclaredBy: null,
  factDeclaredAt: null,
  ...overrides,
});

const declared = (overrides: Partial<SeriesFact>): Partial<SeriesFact> => ({
  factDeclaredBy: "lena",
  factDeclaredAt: "2026-09-14T10:00:00Z",
  ...overrides,
});

type State = "read" | "pile" | "borrowed-read" | "disposed";

/** Un tome dans un état donné — les faits sont ceux de la règle de pile (§4.6/§4.13). */
const volume = (number: string | null, state: State, seriesId = "s1"): SeriesBookFact => ({
  id: `b-${seriesId}-${number ?? "x"}-${state}`,
  seriesId,
  title: `Tome ${number ?? "?"}`,
  category: "bd",
  issueNumber: number,
  coverUrl: null,
  purchases: [],
  readings:
    state === "read" || state === "borrowed-read"
      ? [{ status: "finished", finishedAt: "2026-08-01", deletedAt: null }]
      : [],
  ownerships:
    state === "borrowed-read"
      ? []
      : state === "disposed"
        ? [{ ownedSince: "2026-01-01", disposedAt: "2026-06-01", deletedAt: null }]
        : [{ ownedSince: "2026-01-01", disposedAt: null, deletedAt: null }],
});

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);
const volumes = (numbers: number[], state: State) => numbers.map((number) => volume(String(number), state));

describe("deriveSeriesProgress — lus · dans la pile · total", () => {
  it("Lastman : 8 lus, 2 en pile, total 12 → en cours, à lire ensuite le 9 qui est dans la pile", () => {
    const progress = deriveSeriesProgress(series(declared({ totalVolumes: 12 })), [
      ...volumes(range(1, 8), "read"),
      ...volumes([9, 10], "pile"),
    ]);
    expect(progress).toMatchObject({
      read: 8,
      pile: 2,
      totalVolumes: 12,
      gridMax: 12,
      status: "in-progress",
      next: { kind: "read-next", number: 9, bookId: "b-s1-9-pile" },
      isVisible: true,
    });
    expect(progress.readNumbers).toEqual(range(1, 8));
    expect(progress.pileNumbers).toEqual([9, 10]);
  });

  it("One Piece : parution en cours, 12 lus, 4 en pile → en cours, le 13 est dans la pile, grille jusqu'au plus grand possédé", () => {
    const progress = deriveSeriesProgress(series(declared({ isOngoing: true })), [
      ...volumes(range(1, 12), "read"),
      ...volumes(range(13, 16), "pile"),
    ]);
    expect(progress).toMatchObject({ status: "in-progress", gridMax: 16, next: { kind: "read-next", number: 13 } });
  });

  it("Saga : 3 lus, pas de total → « total à déclarer », aucun suivant annoncé", () => {
    const progress = deriveSeriesProgress(series(), volumes([1, 2, 3], "read"));
    expect(progress).toMatchObject({ status: "unknown-total", gridMax: 3, next: null, isVisible: true });
  });

  it("Saga, total déclaré 10 → « il te manque le tome 4 »", () => {
    const progress = deriveSeriesProgress(series(declared({ totalVolumes: 10 })), volumes([1, 2, 3], "read"));
    expect(progress).toMatchObject({ status: "in-progress", gridMax: 10, next: { kind: "missing", number: 4 } });
  });

  it("Le Trône de fer : un tome LU sans numéro → approximatif, jauge et suivant muets", () => {
    const progress = deriveSeriesProgress(series(declared({ totalVolumes: 15 })), [
      volume("1", "read"),
      volume(null, "read"),
      volume("3", "pile"),
    ]);
    expect(progress).toMatchObject({ status: "approximate", unnumberedRead: 1, next: null, read: 2, pile: 1 });
  });

  it("un tome EN PILE sans numéro ne bloque rien : il est juste hors grille", () => {
    const progress = deriveSeriesProgress(series(declared({ totalVolumes: 5 })), [
      volume("1", "read"),
      volume(null, "pile"),
      volume("2", "pile"),
    ]);
    expect(progress).toMatchObject({ status: "in-progress", unnumberedRead: 0, pile: 2, next: { kind: "read-next", number: 2 } });
  });

  it("Frieren : parution en cours, tout le possédé est lu → à jour", () => {
    const progress = deriveSeriesProgress(series(declared({ isOngoing: true })), volumes(range(1, 6), "read"));
    expect(progress).toMatchObject({ status: "up-to-date", next: { kind: "up-to-date" } });
  });

  it("Blacksad : 7 tomes lus sur 7 déclarés → complète", () => {
    const progress = deriveSeriesProgress(series(declared({ totalVolumes: 7 })), volumes(range(1, 7), "read"));
    expect(progress).toMatchObject({ status: "complete", next: { kind: "complete" } });
  });

  it("un trou derrière : tomes 1 et 3 lus → c'est le 2 qu'on propose (règle #30), à acheter s'il manque", () => {
    const progress = deriveSeriesProgress(series(declared({ totalVolumes: 5 })), volumes([1, 3], "read"));
    expect(progress.next).toEqual({ kind: "missing", number: 2 });
  });

  it("total déclaré INFÉRIEUR au possédé : la grille suit le total, le surplus reste compté", () => {
    const progress = deriveSeriesProgress(series(declared({ totalVolumes: 3 })), [
      ...volumes([1, 2, 3], "read"),
      volume("4", "pile"),
    ]);
    // Les tomes 1..3 sont lus : complète au sens du total déclaré ; le 4 est
    // dans la pile et sera visible dans la fiche (gridMax = 3, mais pile = 1).
    expect(progress).toMatchObject({ status: "complete", gridMax: 3, pile: 1 });
  });

  it("un emprunt lu compte comme lu, sans jamais entrer dans la pile", () => {
    const progress = deriveSeriesProgress(series(declared({ totalVolumes: 3 })), [
      volume("1", "borrowed-read"),
      volume("2", "pile"),
    ]);
    expect(progress).toMatchObject({ read: 1, pile: 1, next: { kind: "read-next", number: 2 } });
  });

  it("un tome cédé n'est ni lu ni dans la pile", () => {
    const progress = deriveSeriesProgress(series(declared({ totalVolumes: 3 })), [
      volume("1", "read"),
      volume("2", "disposed"),
    ]);
    expect(progress).toMatchObject({ read: 1, pile: 0, next: { kind: "missing", number: 2 } });
    expect(progress.volumes.find((candidate) => candidate.number === 2)?.state).toBe("other");
  });

  it("deux exemplaires du même tome comptent deux livres lus mais un seul numéro", () => {
    const progress = deriveSeriesProgress(series(declared({ totalVolumes: 2 })), [
      volume("1", "read"),
      { ...volume("1", "read"), id: "b-dup" },
    ]);
    expect(progress).toMatchObject({ read: 2, readNumbers: [1], next: { kind: "missing", number: 2 } });
  });

  it("l'indice GCD est transporté tel quel — jamais une vérité", () => {
    const progress = deriveSeriesProgress(series(), volumes([1, 2], "read"), 15);
    expect(progress.gcdKnownMax).toBe(15);
    expect(progress.status).toBe("unknown-total");
  });

  it("un tome 0 lu (prologue) ne compte pas pour « complète » (review #295)", () => {
    const progress = deriveSeriesProgress(series(declared({ totalVolumes: 3 })), volumes([0, 1, 2], "read"));
    expect(progress).toMatchObject({ status: "in-progress", next: { kind: "missing", number: 3 } });
  });

  it("deux tomes cédés ne font pas une série à suivre : sous le seuil (review #295)", () => {
    const progress = deriveSeriesProgress(series(), [volume("1", "disposed"), volume("2", "disposed")]);
    expect(progress.isVisible).toBe(false);
    // Avec un tome lu et un dans la pile, si.
    expect(deriveSeriesProgress(series(), [volume("1", "read"), volume("2", "pile")]).isVisible).toBe(true);
  });

  it("la catégorie affichée est celle de la majorité des tomes, pas la colonne de la série (review #295)", () => {
    const progress = deriveSeriesProgress(series({ category: "comics" }), [
      { ...volume("1", "read"), category: "manga" },
      { ...volume("2", "read"), category: "manga" },
      { ...volume("3", "pile"), category: "bd" },
    ]);
    expect(progress.category).toBe("manga");
    // Sans livre, la colonne sert de repli.
    expect(deriveSeriesProgress(series({ category: "comics" }), []).category).toBe("comics");
  });

  it("un numéro non canonique (« Tome 02 ») est lu comme 2", () => {
    const progress = deriveSeriesProgress(series(declared({ totalVolumes: 3 })), [volume("Tome 02", "read")]);
    expect(progress.readNumbers).toEqual([2]);
  });
});

describe("summarizeSeries — la moisson pour les Stats (lot C)", () => {
  const list = [
    deriveSeriesProgress(series({ id: "lastman", name: "Lastman", ...declared({ totalVolumes: 12 }) }), [
      ...volumes(range(1, 8), "read").map((book) => ({ ...book, seriesId: "lastman" })),
      ...volumes([9, 10], "pile").map((book) => ({ ...book, seriesId: "lastman" })),
    ]),
    deriveSeriesProgress(series({ id: "saga", name: "Saga", ...declared({ totalVolumes: 10 }) }), volumes([1, 2, 3], "read").map((book) => ({ ...book, seriesId: "saga" }))),
    deriveSeriesProgress(series({ id: "frieren", name: "Frieren", ...declared({ isOngoing: true }) }), volumes(range(1, 6), "read").map((book) => ({ ...book, seriesId: "frieren" }))),
    deriveSeriesProgress(series({ id: "blacksad", name: "Blacksad", ...declared({ totalVolumes: 7 }) }), volumes(range(1, 7), "read").map((book) => ({ ...book, seriesId: "blacksad" }))),
    deriveSeriesProgress(series({ id: "onepiece", name: "One Piece", ...declared({ isOngoing: true }) }), [
      ...volumes(range(1, 12), "read").map((book) => ({ ...book, seriesId: "onepiece" })),
      ...volumes(range(13, 16), "pile").map((book) => ({ ...book, seriesId: "onepiece" })),
    ]),
  ];

  it("compte les états, la dette, les plus grosses dettes et les suivants — dans la pile d'abord", () => {
    const summary = summarizeSeries(list);
    expect(summary).toMatchObject({ inProgress: 3, upToDate: 1, complete: 1, debt: 6 });
    expect(summary.topDebt.map((entry) => [entry.name, entry.pile])).toEqual([
      ["One Piece", 4],
      ["Lastman", 2],
    ]);
    expect(summary.nextToRead.map((entry) => [entry.name, entry.next.kind])).toEqual([
      ["Lastman", "read-next"],
      ["One Piece", "read-next"],
      ["Saga", "missing"],
    ]);
  });

  it("le vivier « on continue une série » = les tomes suivants déjà dans la pile", () => {
    // Les ids viennent de la fixture `volume()` (série par défaut « s1 » dans l'id, remappée ensuite).
    expect(nextInPileBookIds(list)).toEqual(new Set(["b-s1-9-pile", "b-s1-13-pile"]));
  });

  it("une liste vide donne une moisson vide", () => {
    expect(summarizeSeries([])).toEqual({ inProgress: 0, upToDate: 0, complete: 0, debt: 0, topDebt: [], nextToRead: [] });
  });
});

describe("deriveSeries — la liste", () => {
  const a = series({ id: "a", name: "One Piece" });
  const b = series({ id: "b", name: "Blacksad" });
  const single = series({ id: "c", name: "Solo" });
  const singleDeclared = series(declared({ id: "d", name: "Déclarée", totalVolumes: 3 }));

  it(`ignore les séries de moins de ${MIN_BOOKS_TO_SHOW_SERIES} livres, sauf celles qui ont un fait déclaré`, () => {
    const list = deriveSeries(
      [a, b, single, singleDeclared],
      [
        ...volumes([1, 2], "read").map((book) => ({ ...book, seriesId: "a" })),
        ...volumes([1, 2], "read").map((book) => ({ ...book, seriesId: "b" })),
        { ...volume("1", "read"), seriesId: "c" },
        { ...volume("1", "read"), seriesId: "d" },
      ],
    );
    expect(list.map((progress) => progress.seriesId)).toEqual(["b", "a", "d"]); // 2 lus, 2 lus (nom), puis 1 lu
  });

  it("trie par dette décroissante, puis lus décroissants, puis nom", () => {
    const list = deriveSeries(
      [a, b],
      [
        ...volumes([1], "read").map((book) => ({ ...book, seriesId: "a" })),
        ...volumes([2, 3, 4], "pile").map((book) => ({ ...book, seriesId: "a" })),
        ...volumes([1, 2, 3], "read").map((book) => ({ ...book, seriesId: "b" })),
        ...volumes([4], "pile").map((book) => ({ ...book, seriesId: "b" })),
      ],
    );
    expect(list.map((progress) => [progress.seriesId, progress.pile, progress.read])).toEqual([
      ["a", 3, 1],
      ["b", 1, 3],
    ]);
  });

  it("l'indice GCD se lit par série", () => {
    const list = deriveSeries([a], volumes([1, 2], "read").map((book) => ({ ...book, seriesId: "a" })), new Map([["a", 108]]));
    expect(list[0].gcdKnownMax).toBe(108);
  });
});
