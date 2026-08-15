import { describe, expect, it } from "vitest";
import { circleMonths, rankParticipants, yearTotal } from "./ranking";

describe("rankParticipants", () => {
  it("trie par score décroissant, 1-indexé", () => {
    const ranked = rankParticipants([
      { participantId: "a", score: 3 },
      { participantId: "b", score: 10.5 },
      { participantId: "c", score: 7 },
    ]);
    expect(ranked.map((entry) => [entry.participantId, entry.rank])).toEqual([
      ["b", 1],
      ["c", 2],
      ["a", 3],
    ]);
  });

  it("ex-aequo = même rang, et le rang suivant saute (1, 1, 3 — §4.14)", () => {
    const ranked = rankParticipants([
      { participantId: "a", score: 8 },
      { participantId: "b", score: 8 },
      { participantId: "c", score: 2 },
    ]);
    expect(ranked.map((entry) => entry.rank)).toEqual([1, 1, 3]);
  });

  it("sans ligne = hors rang (« — »), après les classés, ordre d'entrée conservé", () => {
    const ranked = rankParticipants([
      { participantId: "sans-bilan-1", score: null },
      { participantId: "a", score: 0 },
      { participantId: "sans-bilan-2", score: null },
    ]);
    expect(ranked.map((entry) => [entry.participantId, entry.rank])).toEqual([
      ["a", 1], // un mois JOUÉ à zéro est classé — pas confondu avec l'absence de bilan
      ["sans-bilan-1", null],
      ["sans-bilan-2", null],
    ]);
  });

  it("à score égal, l'ordre d'entrée départage (tri stable — l'appelant trie par pseudo)", () => {
    const ranked = rankParticipants([
      { participantId: "léna", score: 5 },
      { participantId: "prem", score: 5 },
    ]);
    expect(ranked.map((entry) => entry.participantId)).toEqual(["léna", "prem"]);
  });

  it("les scores négatifs se classent (un mois de malus reste un mois joué)", () => {
    const ranked = rankParticipants([
      { participantId: "a", score: -3 },
      { participantId: "b", score: 0 },
    ]);
    expect(ranked.map((entry) => [entry.participantId, entry.rank])).toEqual([
      ["b", 1],
      ["a", 2],
    ]);
  });
});

describe("yearTotal", () => {
  it("somme les mois clos de l'année civile, et seulement eux", () => {
    const months = [
      { month: "2025-12", total: 10 },
      { month: "2026-01", total: 3.5 },
      { month: "2026-07", total: -1 },
    ];
    expect(yearTotal(months, "2026")).toBe(2.5);
    expect(yearTotal(months, "2025")).toBe(10);
  });

  it("aucun mois clos dans l'année → null (hors rang) — le cas janvier", () => {
    expect(yearTotal([{ month: "2025-12", total: 10 }], "2026")).toBeNull();
    expect(yearTotal([], "2026")).toBeNull();
  });
});

describe("circleMonths", () => {
  it("l'union des mois du cercle, du plus récent au plus ancien, sans doublon", () => {
    expect(
      circleMonths([
        ["2026-05", "2026-07"],
        ["2026-07", "2025-12"],
        [],
      ]),
    ).toEqual(["2026-07", "2026-05", "2025-12"]);
  });

  it("cercle sans aucun mois → vide", () => {
    expect(circleMonths([[], []])).toEqual([]);
  });
});
