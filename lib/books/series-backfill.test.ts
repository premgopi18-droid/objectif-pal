import { describe, expect, it } from "vitest";
import type { BnfRecord } from "@/lib/resolution/providers/bnf";
import { planSeriesBackfill } from "./series-backfill";

const record = (overrides: Partial<BnfRecord> = {}): BnfRecord => ({
  title: "Ace entre en scène",
  seriesName: "One piece",
  issueNumber: "18",
  bnfSeriesId: "38888890",
  authors: "Eiichirō Oda",
  publisher: "Glénat",
  pageCount: 224,
  ...overrides,
});

describe("planSeriesBackfill — ne remplir que les champs vides", () => {
  it("un livre sans série ni numéro reçoit les deux, avec l'identifiant de série BnF", () => {
    expect(planSeriesBackfill({ series_name: null, issue_number: null }, record())).toEqual({
      outcome: "fill",
      update: { series_name: "One piece", issue_number: "18" },
      seriesRef: { source: "bnf", id: "38888890" },
    });
  });

  it("un numéro déjà posé par l'utilisateur n'est jamais écrasé", () => {
    expect(planSeriesBackfill({ series_name: null, issue_number: "1" }, record())).toEqual({
      outcome: "fill",
      update: { series_name: "One piece" },
      seriesRef: { source: "bnf", id: "38888890" },
    });
  });

  it("une série sans numéro ni notice de série ne remplit que le nom", () => {
    expect(
      planSeriesBackfill({ series_name: null, issue_number: null }, record({ issueNumber: null, bnfSeriesId: null })),
    ).toEqual({ outcome: "fill", update: { series_name: "One piece" }, seriesRef: null });
  });

  it("un livre qui a déjà une série est laissé tel quel — même si la notice dit autre chose", () => {
    expect(planSeriesBackfill({ series_name: "One Piece", issue_number: null }, record())).toEqual({
      outcome: "already-filled",
    });
  });

  it("une notice sans série (roman, one-shot) ne change rien", () => {
    expect(planSeriesBackfill({ series_name: null, issue_number: null }, record({ seriesName: null }))).toEqual({
      outcome: "no-series",
    });
  });

  it("aucune notice : rien à écrire", () => {
    expect(planSeriesBackfill({ series_name: null, issue_number: null }, null)).toEqual({ outcome: "no-record" });
  });
});
