import { describe, expect, it } from "vitest";
import type { BookCategory } from "@/lib/scoring/types";
import type { SeriesStatus } from "@/lib/series/derive-series";
import { categoryChips, filterSeriesByQueryAndCategory, filterSeriesProgress } from "./filter";

const entry = (name: string, category: BookCategory, status: SeriesStatus = "in-progress") => ({ name, category, status });

const list = [
  entry("Ippo", "manga", "up-to-date"),
  entry("Dungeon crawler Carl", "roman", "unknown-total"),
  entry("Absolute Superman", "comics"),
  entry("Les Sentinelles", "bd", "complete"),
  entry("Élan d'Écosse", "bd"),
];

describe("filterSeriesByQueryAndCategory — recherche + catégorie", () => {
  it("recherche insensible aux accents et à la casse, sur le nom seulement", () => {
    expect(filterSeriesByQueryAndCategory(list, { query: "ippo", category: "all" }).map((item) => item.name)).toEqual(["Ippo"]);
    expect(filterSeriesByQueryAndCategory(list, { query: "ELAN D'ecosse", category: "all" }).map((item) => item.name)).toEqual(["Élan d'Écosse"]);
    expect(filterSeriesByQueryAndCategory(list, { query: "dcc", category: "all" })).toEqual([]);
    expect(filterSeriesByQueryAndCategory(list, { query: "   ", category: "all" })).toHaveLength(5);
  });

  it("catégorie, et cumul avec la recherche", () => {
    expect(filterSeriesByQueryAndCategory(list, { query: "", category: "bd" }).map((item) => item.name)).toEqual(["Les Sentinelles", "Élan d'Écosse"]);
    expect(filterSeriesByQueryAndCategory(list, { query: "sent", category: "bd" }).map((item) => item.name)).toEqual(["Les Sentinelles"]);
    expect(filterSeriesByQueryAndCategory(list, { query: "sent", category: "manga" })).toEqual([]);
  });
});

describe("filterSeriesProgress — les trois filtres cumulés", () => {
  it("l'état s'applique après recherche et catégorie", () => {
    expect(filterSeriesProgress(list, { query: "", category: "all", status: "complete" }).map((item) => item.name)).toEqual(["Les Sentinelles"]);
    expect(filterSeriesProgress(list, { query: "", category: "bd", status: "in-progress" }).map((item) => item.name)).toEqual(["Élan d'Écosse"]);
    // « En cours » regroupe ce qui reste à lire OU à renseigner (proto).
    expect(filterSeriesProgress(list, { query: "", category: "roman", status: "in-progress" }).map((item) => item.name)).toEqual(["Dungeon crawler Carl"]);
  });
});

describe("categoryChips — « Toutes », puis les catégories présentes seulement, dans l'ordre du barème", () => {
  it("compte, ordonne, omet les absentes", () => {
    expect(categoryChips(list)).toEqual([
      { value: "all", label: "Tous les types" },
      { value: "manga", label: "Manga (1)" },
      { value: "bd", label: "BD (2)" },
      { value: "comics", label: "Comics (1)" },
      { value: "roman", label: "Roman (1)" },
    ]);
    expect(categoryChips([])).toEqual([{ value: "all", label: "Tous les types" }]);
  });
});
