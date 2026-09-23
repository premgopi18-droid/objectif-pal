import { describe, expect, it } from "vitest";
import { applyReadingPatch, READING_PATCHES } from "./reading-patch";

/**
 * L'état optimiste du Journal (fluidité #331, item 3) : ce que la ligne montre
 * au tap, avant la confirmation du serveur.
 */
const readings = [
  { id: "r1", status: "reading" as const, finishedAt: null, rating: 4 },
  { id: "r2", status: "finished" as const, finishedAt: "2026-09-01", rating: null },
  { id: "r3", status: "abandoned" as const, finishedAt: null, rating: null },
];

describe("applyReadingPatch — l'optimisme du Journal", () => {
  it("« Terminé ✓ » : la lecture passe terminée, datée du jour, les autres champs intacts", () => {
    const next = applyReadingPatch(readings, READING_PATCHES.finish("r1", "2026-09-23"));
    expect(next[0]).toEqual({ id: "r1", status: "finished", finishedAt: "2026-09-23", rating: 4 });
  });

  it("« Abandonner » ne touche pas à la date de fin (elle n'existe pas)", () => {
    const next = applyReadingPatch(readings, READING_PATCHES.abandon("r1"));
    expect(next[0]).toMatchObject({ status: "abandoned", finishedAt: null });
  });

  it("« Reprendre » remet en cours", () => {
    const next = applyReadingPatch(readings, READING_PATCHES.resume("r3"));
    expect(next[2]).toMatchObject({ status: "reading" });
  });

  it("« Repasser en cours » remet en cours ET efface la date de fin", () => {
    const next = applyReadingPatch(readings, READING_PATCHES.reopen("r2"));
    expect(next[1]).toMatchObject({ status: "reading", finishedAt: null });
  });

  it("ne touche que la lecture visée, et rend un nouveau tableau (la vérité serveur n'est jamais mutée)", () => {
    const next = applyReadingPatch(readings, READING_PATCHES.finish("r1", "2026-09-23"));
    expect(next).not.toBe(readings);
    expect(next[1]).toBe(readings[1]);
    expect(next[2]).toBe(readings[2]);
    expect(readings[0].status).toBe("reading");
  });

  it("un identifiant inconnu ne change rien", () => {
    const next = applyReadingPatch(readings, READING_PATCHES.finish("nope", "2026-09-23"));
    expect(next).toEqual(readings);
  });
});
