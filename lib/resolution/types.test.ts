import { describe, expect, it } from "vitest";
import { sanitizePageCount } from "./types";

/**
 * Le zéro du monde réel (#154, vu en prod) : « 0 pages » d'une source n'est
 * pas un nombre de pages, c'est un inconnu — et il ne doit JAMAIS bloquer un
 * geste ni se figer dans le cache.
 */
describe("sanitizePageCount", () => {
  it("un entier positif passe tel quel", () => {
    expect(sanitizePageCount(368)).toBe(368);
  });

  it("0, négatif, décimal, null, undefined → inconnu (null)", () => {
    expect(sanitizePageCount(0)).toBeNull();
    expect(sanitizePageCount(-5)).toBeNull();
    expect(sanitizePageCount(12.5)).toBeNull();
    expect(sanitizePageCount(null)).toBeNull();
    expect(sanitizePageCount(undefined)).toBeNull();
  });
});
