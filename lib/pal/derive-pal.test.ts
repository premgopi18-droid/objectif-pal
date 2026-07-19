import { describe, expect, it } from "vitest";
import { bookToMovement, derivePal, type PalBookRecord } from "./derive-pal";

/**
 * La pile doit raconter la MÊME histoire que le bilan (specs §4.5) : chaque
 * règle de pile a son test, y compris le rachat d'un déjà-lu (§3.3) et la
 * relecture qui ne re-vide rien (décision du 14/07/2026). Les fabriques
 * gardent les cas lisibles : un test = une situation de lecteur.
 */

let bookCounter = 0;
let purchaseCounter = 0;

function book(overrides: Partial<PalBookRecord> = {}): PalBookRecord {
  bookCounter += 1;
  return {
    id: `book-${bookCounter}`,
    title: `Livre ${bookCounter}`,
    series_name: null,
    issue_number: null,
    category: "bd",
    cover_url: null,
    deleted_at: null,
    purchases: [],
    readings: [],
    ...overrides,
  };
}

function bought(purchasedAt: string) {
  purchaseCounter += 1;
  return { id: `purchase-${purchaseCounter}`, purchased_at: purchasedAt, deleted_at: null };
}

function finished(finishedAt: string, overrides: Partial<NonNullable<PalBookRecord["readings"]>[number]> = {}) {
  return { status: "finished" as const, finished_at: finishedAt, deleted_at: null, ...overrides };
}

function inProgress() {
  return { status: "reading" as const, finished_at: null, deleted_at: null };
}

describe("les cas nominaux", () => {
  it("un achat sans lecture : le livre est dans la pile, une entrée, aucune sortie", () => {
    const purchase = bought("2026-07-03");
    const result = derivePal([book({ purchases: [purchase] })]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].purchasedAt).toBe("2026-07-03");
    // L'entrée porte l'id de l'achat d'entrée — celui qu'annule « je ne l'ai pas acheté ».
    expect(result.entries[0].purchaseId).toBe(purchase.id);
    expect(result.purchaseDates).toEqual(["2026-07-03"]);
    expect(result.ownedFinishedDates).toEqual([]);
  });

  it("acheté puis lu : le livre sort de la pile — une entrée, une sortie", () => {
    const result = derivePal([
      book({ purchases: [bought("2026-07-03")], readings: [finished("2026-07-20")] }),
    ]);
    expect(result.entries).toEqual([]);
    expect(result.purchaseDates).toEqual(["2026-07-03"]);
    expect(result.ownedFinishedDates).toEqual(["2026-07-20"]);
  });

  it("une lecture sans achat (emprunt) : jamais dans la PAL, ni entrée ni sortie", () => {
    // Le piège des deux dénominateurs (§4.5) : compter cette fin comme une
    // sortie ferait dire à la courbe qu'on vide une pile qui n'a pas bougé.
    const result = derivePal([book({ readings: [finished("2026-07-10")] })]);
    expect(result.entries).toEqual([]);
    expect(result.purchaseDates).toEqual([]);
    expect(result.ownedFinishedDates).toEqual([]);
  });

  it("un achat avec une lecture en cours reste dans la pile, marqué en cours", () => {
    const result = derivePal([book({ purchases: [bought("2026-07-03")], readings: [inProgress()] })]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].isInProgress).toBe(true);
  });
});

describe("le rachat d'un livre déjà lu (§3.3 — le cas de l'audit)", () => {
  it("fini en juin (emprunt), racheté en juillet : juillet affiche 0 entrée · 0 sortie", () => {
    const result = derivePal([
      book({ purchases: [bought("2026-07-05")], readings: [finished("2026-06-12")] }),
    ]);
    // Pas d'entrée : le livre était déjà lu, il ne fait pas grossir la pile.
    expect(result.purchaseDates).toEqual([]);
    // Pas de sortie : une fin antérieure à toute entrée ne vide rien.
    expect(result.ownedFinishedDates).toEqual([]);
    // Et il ne s'affiche pas dans la pile : il n'y est jamais entré.
    expect(result.entries).toEqual([]);
  });

  it("fini le jour même de l'achat : c'est un rachat de déjà-lu, pas une entrée", () => {
    const result = derivePal([
      book({ purchases: [bought("2026-07-05")], readings: [finished("2026-07-05")] }),
    ]);
    expect(result.purchaseDates).toEqual([]);
    expect(result.ownedFinishedDates).toEqual([]);
  });
});

describe("la relecture — une seule sortie par livre (décision du 14/07/2026)", () => {
  it("acheté, lu, relu : deux fins mais UNE sortie, la première", () => {
    const result = derivePal([
      book({
        purchases: [bought("2026-05-01")],
        readings: [finished("2026-05-10"), finished("2026-07-02")],
      }),
    ]);
    expect(result.ownedFinishedDates).toEqual(["2026-05-10"]);
  });
});

describe("les achats multiples du même livre", () => {
  it("deux exemplaires achetés sans lecture : UNE entrée, un seul livre dans la pile", () => {
    // La pile compte des livres à lire, pas des exemplaires (review #22) :
    // le solde du mois doit dire la même chose que la liste en dessous.
    const later = bought("2026-07-08");
    const earlier = bought("2026-07-02");
    const result = derivePal([book({ purchases: [later, earlier] })]);
    expect(result.purchaseDates).toEqual(["2026-07-02"]);
    expect(result.entries).toHaveLength(1);
    // Le plus ancien achat date l'entrée dans la pile — et c'est son id qui remonte.
    expect(result.entries[0].purchasedAt).toBe("2026-07-02");
    expect(result.entries[0].purchaseId).toBe(earlier.id);
  });

  it("deux exemplaires puis une lecture : 1 entrée · 1 sortie — solde nul, comme le bilan (§3.3)", () => {
    // Le cas de la review #22 : compter les entrées par ACHAT donnerait
    // « 2 entrées · 1 sortie », un +1 fantôme que ni la pile affichée (le
    // livre en est sorti) ni le bilan (une lecture annule les deux malus)
    // ne racontent.
    const result = derivePal([
      book({
        purchases: [bought("2026-07-02"), bought("2026-07-08")],
        readings: [finished("2026-07-20")],
      }),
    ]);
    expect(result.purchaseDates).toEqual(["2026-07-02"]);
    expect(result.ownedFinishedDates).toEqual(["2026-07-20"]);
    expect(result.entries).toEqual([]);
  });

  it("acheté, lu, puis racheté : la première entrée sort, le rachat n'entre pas", () => {
    const result = derivePal([
      book({
        purchases: [bought("2026-06-01"), bought("2026-07-15")],
        readings: [finished("2026-06-20")],
      }),
    ]);
    expect(result.purchaseDates).toEqual(["2026-06-01"]);
    expect(result.ownedFinishedDates).toEqual(["2026-06-20"]);
    expect(result.entries).toEqual([]);
  });
});

describe("la suppression douce", () => {
  it("un livre soft-deleted est exclu, achats compris", () => {
    const result = derivePal([book({ deleted_at: "2026-07-01T10:00:00Z", purchases: [bought("2026-06-15")] })]);
    expect(result.entries).toEqual([]);
    expect(result.purchaseDates).toEqual([]);
  });

  it("un achat soft-deleted ne compte ni comme possession ni comme entrée", () => {
    const result = derivePal([
      book({ purchases: [{ id: "purchase-deleted", purchased_at: "2026-07-03", deleted_at: "2026-07-04T09:00:00Z" }] }),
    ]);
    expect(result.entries).toEqual([]);
    expect(result.purchaseDates).toEqual([]);
  });

  it("une lecture soft-deleted ne sort pas le livre de la pile", () => {
    const result = derivePal([
      book({
        purchases: [bought("2026-07-03")],
        readings: [finished("2026-07-10", { deleted_at: "2026-07-11T08:00:00Z" })],
      }),
    ]);
    expect(result.entries).toHaveLength(1);
    expect(result.ownedFinishedDates).toEqual([]);
  });
});

describe("l'ordre d'affichage", () => {
  it("la pile est triée du plus ancien achat au plus récent", () => {
    const result = derivePal([
      book({ purchases: [bought("2026-07-10")] }),
      book({ purchases: [bought("2026-06-02")] }),
    ]);
    expect(result.entries.map((entry) => entry.purchasedAt)).toEqual(["2026-06-02", "2026-07-10"]);
  });
});

describe("bookToMovement — le réducteur partagé faits → mouvement (#78)", () => {
  // Fabriques camelCase : la langue du réducteur (les Rows snake_case passent
  // par l'adaptateur de derivePal, testé au-dessus).
  const purchase = (purchasedAt: string, overrides: { id?: string; deletedAt?: string | null } = {}) => ({
    id: overrides.id ?? `purchase-at-${purchasedAt}`,
    purchasedAt,
    deletedAt: overrides.deletedAt ?? null,
  });
  const reading = (
    status: "finished" | "reading" | "abandoned",
    finishedAt: string | null = null,
    deletedAt: string | null = null,
  ) => ({ status, finishedAt, deletedAt });

  it("aucun achat (emprunt) : pas de mouvement — le livre n'entre jamais en pile", () => {
    expect(bookToMovement({ purchases: [], readings: [reading("finished", "2026-07-10")] })).toBeNull();
  });

  it("un achat annulé (soft-deleted) ne compte pas comme possession", () => {
    expect(
      bookToMovement({ purchases: [purchase("2026-07-03", { deletedAt: "2026-07-04T09:00:00Z" })], readings: [] }),
    ).toBeNull();
  });

  it("un achat sans lecture : une entrée, pas de sortie, l'achat d'entrée remonte avec ses champs propres", () => {
    const entry = purchase("2026-07-03", { id: "the-entry-purchase" });
    const movement = bookToMovement({ purchases: [entry], readings: [] });
    expect(movement).toEqual({ entryDate: "2026-07-03", exitDate: null, entryPurchase: entry });
  });

  it("deux exemplaires en désordre : l'entrée est datée et portée par le PLUS ANCIEN achat actif", () => {
    const later = purchase("2026-07-08", { id: "later" });
    const earlier = purchase("2026-07-02", { id: "earlier" });
    const movement = bookToMovement({ purchases: [later, earlier], readings: [] });
    expect(movement?.entryDate).toBe("2026-07-02");
    expect(movement?.entryPurchase.id).toBe("earlier");
  });

  it("acheté puis lu : la fin terminée fait la sortie", () => {
    const movement = bookToMovement({
      purchases: [purchase("2026-07-03")],
      readings: [reading("finished", "2026-07-20")],
    });
    expect(movement?.entryDate).toBe("2026-07-03");
    expect(movement?.exitDate).toBe("2026-07-20");
  });

  it("racheter un déjà-lu (§3.3) : pas de mouvement du tout", () => {
    expect(
      bookToMovement({ purchases: [purchase("2026-07-05")], readings: [reading("finished", "2026-06-12")] }),
    ).toBeNull();
  });

  it("ni l'abandon ni la lecture supprimée ne comptent comme fin : le livre reste en pile", () => {
    const movement = bookToMovement({
      purchases: [purchase("2026-07-03")],
      readings: [reading("abandoned"), reading("finished", "2026-07-10", "2026-07-11T08:00:00Z")],
    });
    expect(movement?.exitDate).toBeNull();
  });
});
