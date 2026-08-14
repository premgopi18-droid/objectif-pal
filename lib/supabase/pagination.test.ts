import { describe, expect, it, vi } from "vitest";
import { fetchAllRows, POSTGREST_MAX_ROWS } from "./pagination";

/**
 * L'anti-troncature (#178) : la boucle doit ramener TOUT, y compris quand le
 * total tombe pile sur une frontière de page — le cas piège où la dernière
 * page pleine force un aller-retour de plus pour constater la fin.
 */
describe("fetchAllRows", () => {
  const dataset = (total: number) => Array.from({ length: total }, (_, index) => index);
  const pageFetcher = (total: number) => {
    const rows = dataset(total);
    return vi.fn(async (from: number, to: number) => rows.slice(from, to + 1));
  };

  it("moins d'une page : un seul aller-retour", async () => {
    const fetchPage = pageFetcher(3);
    expect(await fetchAllRows(fetchPage)).toEqual([0, 1, 2]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(0, POSTGREST_MAX_ROWS - 1);
  });

  it("au-delà du plafond : toutes les lignes, dans l'ordre", async () => {
    const total = POSTGREST_MAX_ROWS + 250;
    const fetchPage = pageFetcher(total);
    const rows = await fetchAllRows(fetchPage);
    expect(rows).toHaveLength(total);
    expect(rows[0]).toBe(0);
    expect(rows[total - 1]).toBe(total - 1);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("total PILE sur la frontière : un aller-retour de plus, zéro ligne perdue", async () => {
    const total = POSTGREST_MAX_ROWS * 2;
    const fetchPage = pageFetcher(total);
    expect(await fetchAllRows(fetchPage)).toHaveLength(total);
    // 2 pages pleines + 1 page vide qui prouve la fin.
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("table vide : une page vide, rien d'autre", async () => {
    const fetchPage = pageFetcher(0);
    expect(await fetchAllRows(fetchPage)).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
