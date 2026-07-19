import { describe, expect, it } from "vitest";
import type { BookInput } from "./actions";
import { manualEntryToCacheEntry } from "./manual-cache";

const manualInput = (overrides: Partial<BookInput> = {}): BookInput => ({
  title: "HEROICS – Season 1: Fathers",
  seriesName: "HEROICS",
  issueNumber: "1",
  authors: "Maxime Garbarini",
  publisher: "Northstar Comics",
  pageCount: 200,
  coverUrl: "https://images.epagine.fr/851/9782955689851_1_75.jpg",
  category: "comics",
  barcodeRaw: "9782955689851",
  barcodeType: "isbn",
  isbn: "9782955689851",
  metadataSource: "manual",
  metadataSourceId: null,
  ...overrides,
});

describe("la saisie manuelle qui alimente barcode_cache (#55)", () => {
  it("une saisie manuelle avec code-barres devient une entrée source manual, couverture comprise", () => {
    expect(manualEntryToCacheEntry(manualInput())).toEqual({
      barcode: "9782955689851",
      title: "HEROICS – Season 1: Fathers",
      seriesName: "HEROICS",
      issueNumber: "1",
      authors: "Maxime Garbarini",
      publisher: "Northstar Comics",
      pageCount: 200,
      coverUrl: "https://images.epagine.fr/851/9782955689851_1_75.jpg",
      source: "manual",
      sourceId: null,
    });
  });

  it("la clé suit la normalisation de la cascade : EAN-13 pour un ISBN scanné avec supplément prix", () => {
    const entry = manualEntryToCacheEntry(
      manualInput({ barcodeRaw: "978295568985151990", isbn: "9782955689851" }),
    );
    expect(entry?.barcode).toBe("9782955689851");
  });

  it("un UPC garde son code BRUT (le supplément y est signifiant, specs §5.1)", () => {
    const entry = manualEntryToCacheEntry(
      manualInput({ barcodeRaw: "76194134174312311", barcodeType: "upc", isbn: null }),
    );
    expect(entry?.barcode).toBe("76194134174312311");
  });

  it("une création libre (sans code-barres) n'a pas de clé : rien à cacher", () => {
    expect(manualEntryToCacheEntry(manualInput({ barcodeRaw: null, barcodeType: null, isbn: null }))).toBeNull();
  });

  it("une résolution de source (non manuelle) ne repasse pas par ce chemin", () => {
    expect(manualEntryToCacheEntry(manualInput({ metadataSource: "bnf" }))).toBeNull();
  });
});
