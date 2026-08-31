import { describe, expect, it } from "vitest";
import {
  ALREADY_READ_MESSAGE,
  FINISH_BEFORE_START_MESSAGE,
  IN_PROGRESS_NEEDS_DATE_MESSAGE,
  formatBulkFailures,
  planBulkRead,
  type BulkReadFacts,
} from "./bulk-read-plan";

/**
 * Le plan du lot (#256) reprend les gardes des gestes unitaires — on vérifie
 * ici qu'aucune ne s'est perdue en route : c'est lui qui empêche le double-tap
 * d'un lot de compter des points en double au bilan (§3).
 */

const facts = (overrides: Partial<BulkReadFacts> = {}): BulkReadFacts => ({
  inProgress: null,
  hasUndatedFinish: false,
  finishedDates: [],
  ...overrides,
});

describe("planBulkRead — le cas nominal", () => {
  it("un livre jamais lu s'insère, daté", () => {
    expect(planBulkRead(facts(), "2026-08-31")).toEqual({ kind: "insert" });
  });

  it("un livre jamais lu s'insère aussi en « date inconnue » (0 point, #101)", () => {
    expect(planBulkRead(facts(), null)).toEqual({ kind: "insert" });
  });

  it("une relecture à une AUTRE date reste légitime (§4.2 — un fait de plus, pas un doublon)", () => {
    expect(planBulkRead(facts({ finishedDates: ["2026-07-14"] }), "2026-08-31")).toEqual({
      kind: "insert",
    });
  });
});

describe("planBulkRead — la lecture en cours", () => {
  it("daté : on la TERMINE à la date commune (le sens évident du geste)", () => {
    expect(
      planBulkRead(facts({ inProgress: { readingId: "r1", startedAt: "2026-08-01" } }), "2026-08-31"),
    ).toEqual({ kind: "finish", readingId: "r1" });
  });

  it("« date inconnue » : refus doux — pas de fin inconnue sur une lecture active", () => {
    expect(planBulkRead(facts({ inProgress: { readingId: "r1", startedAt: null } }), null)).toEqual({
      kind: "refuse",
      error: IN_PROGRESS_NEEDS_DATE_MESSAGE,
    });
  });

  it("la fin ne précède jamais le début (même garde que finishReading)", () => {
    expect(
      planBulkRead(facts({ inProgress: { readingId: "r1", startedAt: "2026-08-15" } }), "2026-08-10"),
    ).toEqual({ kind: "refuse", error: FINISH_BEFORE_START_MESSAGE });
  });

  it("sans début connu, pas d'ordre à respecter : la date commune passe", () => {
    expect(
      planBulkRead(facts({ inProgress: { readingId: "r1", startedAt: null } }), "2026-08-10"),
    ).toEqual({ kind: "finish", readingId: "r1" });
  });
});

describe("planBulkRead — la garde du doublon (celle du double-tap du lot)", () => {
  it("terminé à la MÊME date : refus, même formulation que recordPastReading", () => {
    expect(planBulkRead(facts({ finishedDates: ["2026-08-31"] }), "2026-08-31")).toEqual({
      kind: "refuse",
      error: ALREADY_READ_MESSAGE,
    });
  });

  it("« date inconnue » alors qu'une lecture sans date existe déjà : refus", () => {
    expect(planBulkRead(facts({ hasUndatedFinish: true }), null)).toEqual({
      kind: "refuse",
      error: ALREADY_READ_MESSAGE,
    });
  });

  it("une fin sans date n'interdit PAS une fin datée (et réciproquement)", () => {
    // Les deux modes ont chacun leur doublon : ils ne se bloquent pas entre eux.
    expect(planBulkRead(facts({ hasUndatedFinish: true }), "2026-08-31")).toEqual({ kind: "insert" });
    expect(planBulkRead(facts({ finishedDates: ["2026-08-31"] }), null)).toEqual({ kind: "insert" });
  });

  it("la lecture en cours prime sur le doublon : c'est ELLE qu'on termine", () => {
    // Livre relu : une fin datée existe ET une lecture est en cours — le geste
    // termine la lecture active, il n'insère pas une seconde fin.
    expect(
      planBulkRead(
        facts({ inProgress: { readingId: "r1", startedAt: null }, finishedDates: ["2026-08-31"] }),
        "2026-08-31",
      ),
    ).toEqual({ kind: "finish", readingId: "r1" });
  });
});

describe("formatBulkFailures — le rapport des échecs partiels", () => {
  const titles = new Map([
    ["b1", "Berserk T.4"],
    ["b2", "Watchmen"],
  ]);
  const titleOf = (bookId: string) => titles.get(bookId);

  it("aucun échec → rien à afficher", () => {
    expect(formatBulkFailures([], titleOf)).toBeNull();
  });

  it("un échec : singulier, le titre d'abord", () => {
    expect(formatBulkFailures([{ bookId: "b1", error: ALREADY_READ_MESSAGE }], titleOf)).toBe(
      `1 livre n'a pas suivi — Berserk T.4 : ${ALREADY_READ_MESSAGE}`,
    );
  });

  it("plusieurs échecs : pluriel, une entrée par livre", () => {
    expect(
      formatBulkFailures(
        [
          { bookId: "b1", error: ALREADY_READ_MESSAGE },
          { bookId: "b2", error: IN_PROGRESS_NEEDS_DATE_MESSAGE },
        ],
        titleOf,
      ),
    ).toBe(
      `2 livres n'ont pas suivi — Berserk T.4 : ${ALREADY_READ_MESSAGE} · Watchmen : ${IN_PROGRESS_NEEDS_DATE_MESSAGE}`,
    );
  });

  it("un id que le client ne connaît plus garde un libellé neutre", () => {
    expect(formatBulkFailures([{ bookId: "zz", error: "Livre introuvable." }], titleOf)).toBe(
      "1 livre n'a pas suivi — Un livre : Livre introuvable.",
    );
  });
});
