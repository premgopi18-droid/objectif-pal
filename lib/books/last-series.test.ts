import { describe, expect, it } from "vitest";
import { loadLastManualSeries, saveLastManualSeries } from "./last-series";

/**
 * La mémoire de série de la saisie manuelle (§5.3) — testée avec un faux
 * Storage : le vrai localStorage n'existe pas sous Node, et c'est justement
 * le contrat (absent/interdit → la saisie marche quand même).
 */

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

describe("la mémoire de la dernière série", () => {
  it("mémorise puis restitue la série et sa catégorie", () => {
    const storage = fakeStorage();
    saveLastManualSeries({ seriesName: "Radiant", category: "manga" }, storage);
    expect(loadLastManualSeries(storage)).toEqual({ seriesName: "Radiant", category: "manga" });
  });

  it("une saisie sans série efface la mémoire — pas de vieille série sur un one-shot", () => {
    const storage = fakeStorage();
    saveLastManualSeries({ seriesName: "Radiant", category: "manga" }, storage);
    saveLastManualSeries(null, storage);
    expect(loadLastManualSeries(storage)).toBeNull();
  });

  it("une donnée corrompue ou invalide est ignorée sans casser", () => {
    const key = "objectif-pal.last-manual-series";
    expect(loadLastManualSeries(fakeStorage({ [key]: "{pas du json" }))).toBeNull();
    expect(loadLastManualSeries(fakeStorage({ [key]: JSON.stringify({ seriesName: "" }) }))).toBeNull();
    expect(
      loadLastManualSeries(fakeStorage({ [key]: JSON.stringify({ seriesName: "X", category: "pas-une-catégorie" }) })),
    ).toBeNull();
  });

  it("sans Storage (SSR, navigation privée) : lecture null, écriture sans effet", () => {
    expect(loadLastManualSeries(null)).toBeNull();
    expect(() => saveLastManualSeries({ seriesName: "X", category: "bd" }, null)).not.toThrow();
  });
});
