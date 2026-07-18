import { describe, expect, it } from "vitest";
import { isBookInPile } from "./pile-guard";

/**
 * Le garde du doublon d'achat (specs §4.6, §3.3) : il bloque un « Je l'achète »
 * quand le livre est DÉJÀ dans la pile, mais laisse passer le rachat d'un
 * déjà-lu. Même sémantique que la vue PAL (cœur partagé derivePileStatus) —
 * chaque situation de lecteur a son test.
 */

function bought(purchasedAt: string, deletedAt: string | null = null) {
  return { purchased_at: purchasedAt, deleted_at: deletedAt };
}

function finished(finishedAt: string, deletedAt: string | null = null) {
  return { status: "finished" as const, finished_at: finishedAt, deleted_at: deletedAt };
}

describe("isBookInPile", () => {
  it("un livre jamais acheté n'est pas dans la pile — l'achat est permis", () => {
    expect(isBookInPile([], [])).toBe(false);
  });

  it("acheté et pas lu : dans la pile — un second achat serait bloqué", () => {
    expect(isBookInPile([bought("2026-07-03")], [])).toBe(true);
  });

  it("acheté puis lu : sorti de la pile — le rachat est permis", () => {
    expect(isBookInPile([bought("2026-07-03")], [finished("2026-07-20")])).toBe(false);
  });

  it("racheter un déjà-lu (fin avant l'achat, §3.3) : jamais entré en pile — permis", () => {
    expect(isBookInPile([bought("2026-07-05")], [finished("2026-06-12")])).toBe(false);
  });

  it("un achat soft-deleted ne met pas le livre dans la pile — le rachat est permis", () => {
    expect(isBookInPile([bought("2026-07-03", "2026-07-04T09:00:00Z")], [])).toBe(false);
  });

  it("une lecture soft-deleted ne sort pas le livre : il reste dans la pile", () => {
    expect(isBookInPile([bought("2026-07-03")], [finished("2026-07-20", "2026-07-21T08:00:00Z")])).toBe(true);
  });

  it("une lecture en cours (pas terminée) ne sort pas le livre : toujours dans la pile", () => {
    const reading = { status: "reading" as const, finished_at: null, deleted_at: null };
    expect(isBookInPile([bought("2026-07-03")], [reading])).toBe(true);
  });
});
