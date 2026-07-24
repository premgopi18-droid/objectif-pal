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

describe("isBookInPile avec la possession déclarée (#101)", () => {
  const owns = (overrides: { ownedSince?: string | null; disposedAt?: string | null } = {}) => ({
    owned_since: overrides.ownedSince ?? null,
    disposed_at: overrides.disposedAt ?? null,
    deleted_at: null,
  });

  it("possédé sans achat et pas lu : dans la pile — « je l'achète » serait un doublon", () => {
    expect(isBookInPile([], [], [owns()])).toBe(true);
  });

  it("possédé et déjà lu SANS date : hors pile — pas de sortie datable, mais bien une sortie", () => {
    const readUndated = { status: "finished" as const, finished_at: null, deleted_at: null };
    expect(isBookInPile([], [readUndated], [owns()])).toBe(false);
  });

  it("possédé puis donné : hors pile — le livre n'est plus là", () => {
    expect(isBookInPile([], [], [owns({ disposedAt: "2026-07-12" })])).toBe(false);
  });

  it("acheté MAIS déclaré « je ne le possède plus » : hors pile, la possession fait autorité", () => {
    expect(isBookInPile([bought("2026-06-02")], [], [owns({ disposedAt: "2026-07-12" })])).toBe(false);
  });

  it("le paramètre est optionnel : les appelants d'avant #101 gardent leur comportement", () => {
    expect(isBookInPile([bought("2026-07-03")], [])).toBe(true);
  });

  it("acquis et retiré le MÊME jour (#162) : hors pile — re-rajouter le livre est permis", () => {
    // Le scénario Monster : sans le fix, le filet du rachat (#117) prenait
    // l'acquisition du jour pour un rachat et le garde bloquait le re-rajout
    // (« déjà dans ta PAL ») d'un livre pourtant retiré.
    expect(isBookInPile([], [], [owns({ ownedSince: "2026-07-24", disposedAt: "2026-07-24" })])).toBe(false);
    expect(isBookInPile([bought("2026-07-24")], [], [owns({ disposedAt: "2026-07-24" })])).toBe(false);
  });

  it("racheté STRICTEMENT après la cession : de retour en pile — le doublon d'achat re-bloqué (#117)", () => {
    expect(isBookInPile([bought("2026-07-25")], [], [owns({ disposedAt: "2026-07-24" })])).toBe(true);
  });
});
