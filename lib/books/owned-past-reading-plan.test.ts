import { describe, expect, it } from "vitest";
import { planOwnedPastReading } from "./owned-past-reading-plan";

/**
 * « Possédé, déjà lu » en un geste (fluidité #332, item 5) : ce que le plan
 * décide pour la possession, à partir des faits du livre.
 */
const none = { purchases: [], readings: [], ownerships: [] };

describe("planOwnedPastReading", () => {
  it("livre inconnu de l'étagère : une possession neuve, sans date", () => {
    expect(planOwnedPastReading(none)).toEqual({ kind: "insert" });
  });

  it("déjà dans la pile (possédé, pas lu) : on garde — redéclarer une lecture n'est pas un échec", () => {
    const facts = { ...none, ownerships: [{ id: "o1", owned_since: "2026-01-01", disposed_at: null, deleted_at: null }] };
    expect(planOwnedPastReading(facts)).toEqual({ kind: "keep" });
  });

  it("acheté et pas lu : dans la pile aussi — on garde", () => {
    const facts = { ...none, purchases: [{ purchased_at: "2026-09-01", deleted_at: null }] };
    expect(planOwnedPastReading(facts)).toEqual({ kind: "keep" });
  });

  it("déclaration close (donné, revendu) : on la ressuscite plutôt que d'en insérer une seconde", () => {
    const facts = { ...none, ownerships: [{ id: "o1", owned_since: "2025-01-01", disposed_at: "2026-03-01", deleted_at: null }] };
    expect(planOwnedPastReading(facts)).toEqual({ kind: "revive", ownershipId: "o1" });
  });

  it("déclaration supprimée en douceur : elle ne compte pas — possession neuve", () => {
    const facts = { ...none, ownerships: [{ id: "o1", owned_since: null, disposed_at: null, deleted_at: "2026-02-01" }] };
    expect(planOwnedPastReading(facts)).toEqual({ kind: "insert" });
  });

  it("déjà lu et toujours possédé (hors pile, déclaration ouverte) : on garde — sa date d'acquisition n'est pas effacée", () => {
    const facts = {
      purchases: [],
      readings: [{ status: "finished" as const, finished_at: "2026-05-01", deleted_at: null }],
      ownerships: [{ id: "o1", owned_since: "2024-12-25", disposed_at: null, deleted_at: null }],
    };
    // L'ancien enchaînement (recordOwnership puis recordPastReading) remettait
    // `owned_since` à null ici : une date connue perdue pour rien.
    expect(planOwnedPastReading(facts)).toEqual({ kind: "keep" });
  });
});
