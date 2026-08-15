import { describe, expect, it } from "vitest";
import { sortEntriesBy } from "./entry-sort";

/** Le tri commun des listes (#217) — chaque option, ses égalités, sa stabilité. */

type Fixture = { id: string; createdAt: string; title: string; activityAt?: string };
const get = {
  createdAt: (entry: Fixture) => entry.createdAt,
  title: (entry: Fixture) => entry.title,
};

const entries: Fixture[] = [
  { id: "vieux", createdAt: "2026-01-10T08:00:00Z", title: "Zola" },
  { id: "recent", createdAt: "2026-08-01T08:00:00Z", title: "Astérix" },
  { id: "milieu", createdAt: "2026-05-01T08:00:00Z", title: "La Dernière Flamme" },
];

describe("sortEntriesBy", () => {
  it("« ajout » : le plus récent d'abord (le défaut demandé — #217)", () => {
    expect(sortEntriesBy(entries, "ajout", get).map((entry) => entry.id)).toEqual(["recent", "milieu", "vieux"]);
  });

  it("« ajout-ancien » : l'ordre inverse", () => {
    expect(sortEntriesBy(entries, "ajout-ancien", get).map((entry) => entry.id)).toEqual(["vieux", "milieu", "recent"]);
  });

  it("alphabétique fr, article COMPTÉ (décision du 15/08/2026) — et son inverse", () => {
    expect(sortEntriesBy(entries, "titre", get).map((entry) => entry.title)).toEqual([
      "Astérix",
      "La Dernière Flamme", // à L, pas à D — l'article compte
      "Zola",
    ]);
    expect(sortEntriesBy(entries, "titre-inverse", get).map((entry) => entry.title)).toEqual([
      "Zola",
      "La Dernière Flamme",
      "Astérix",
    ]);
  });

  it("« activite » suit activityAt quand il existe, retombe sur l'ajout sinon", () => {
    const withActivity = entries.map((entry) => ({ ...entry, activityAt: entry.id === "vieux" ? "2026-08-10" : "2026-02-01" }));
    const sorted = sortEntriesBy(withActivity, "activite", { ...get, activityAt: (entry) => entry.activityAt ?? "" });
    expect(sorted[0].id).toBe("vieux"); // vieille fiche, activité d'hier → en tête
    expect(sortEntriesBy(entries, "activite", get).map((entry) => entry.id)).toEqual(["recent", "milieu", "vieux"]);
  });

  it("égalité de date : départage par titre — une rafale sort lisible, et rien n'est muté", () => {
    const burst: Fixture[] = [
      { id: "b", createdAt: "2026-08-01T08:00:00Z", title: "Beta" },
      { id: "a", createdAt: "2026-08-01T08:00:00Z", title: "Alpha" },
    ];
    const sorted = sortEntriesBy(burst, "ajout", get);
    expect(sorted.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(burst.map((entry) => entry.id)).toEqual(["b", "a"]); // l'entrée est intacte
  });
});
