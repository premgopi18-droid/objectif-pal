import { describe, expect, it } from "vitest";
import type { ResolvedBook, ScanLookupResult } from "@/lib/resolution/types";
import { withContributionCover } from "./contributions";

const book: ResolvedBook = {
  title: "T",
  seriesName: null,
  issueNumber: null,
  authors: null,
  publisher: null,
  pageCount: null,
  coverUrl: null,
  suggestedCategory: "bd",
  source: "bnf",
  sourceId: null,
  barcodeType: "isbn",
  barcode: "9782070342266",
  isbn: "9782070342266",
};
const SHARED = "https://x.supabase.co/storage/v1/object/public/covers/shared/9782070342266/a.webp";

describe("withContributionCover (#278) — proposée par défaut seulement quand la cascade n'a rien", () => {
  it("un livre résolu SANS couverture prend la contribution", () => {
    const result = withContributionCover({ kind: "resolved", book }, SHARED);
    expect(result.kind === "resolved" && result.book.coverUrl).toBe(SHARED);
  });

  it("un livre résolu AVEC couverture garde la sienne", () => {
    const result = withContributionCover({ kind: "resolved", book: { ...book, coverUrl: "https://static.metron.cloud/a.jpg" } }, SHARED);
    expect(result.kind === "resolved" && result.book.coverUrl).toBe("https://static.metron.cloud/a.jpg");
  });

  it("un introuvable sans image prend la contribution ; avec image, la garde", () => {
    expect(withContributionCover({ kind: "not-found", coverUrl: null }, SHARED)).toEqual({ kind: "not-found", coverUrl: SHARED });
    expect(withContributionCover({ kind: "not-found", coverUrl: "https://images.epagine.fr/x.jpg" }, SHARED)).toEqual({ kind: "not-found", coverUrl: "https://images.epagine.fr/x.jpg" });
  });

  it("sans contribution, ou sur un pick, rien ne change", () => {
    const pick: ScanLookupResult = { kind: "pick-series", candidates: [] };
    expect(withContributionCover(pick, SHARED)).toBe(pick);
    const bare = { kind: "resolved" as const, book };
    expect(withContributionCover(bare, null)).toBe(bare);
  });
});
