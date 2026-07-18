import { describe, expect, it } from "vitest";
import { mergeBookFieldsOnRescan } from "./book-merge";
import type { BookInput } from "./actions";

/**
 * La règle de fusion au rescan (specs §4.2) : titre et catégorie de l'input
 * font TOUJOURS foi (l'utilisateur vient de les valider) ; les autres champs
 * ne COMBLENT que les NULL sans jamais écraser une valeur existante ; et le
 * livre supprimé en douceur ressuscite.
 */

function input(overrides: Partial<BookInput> = {}): BookInput {
  return {
    title: "Titre input",
    seriesName: "Série input",
    issueNumber: "3",
    authors: "Auteur input",
    publisher: "Éditeur input",
    pageCount: 200,
    coverUrl: "https://example.test/input.jpg",
    category: "manga",
    barcodeRaw: "123456789012",
    barcodeType: "isbn",
    isbn: "9781234567890",
    metadataSource: "manual",
    metadataSourceId: null,
    ...overrides,
  };
}

const existingFull = {
  series_name: "Série existante",
  issue_number: "1",
  authors: "Auteur existant",
  publisher: "Éditeur existant",
  page_count: 100,
  isbn: "9789999999999",
  cover_url: "https://example.test/existing.jpg",
};

const existingEmpty = {
  series_name: null,
  issue_number: null,
  authors: null,
  publisher: null,
  page_count: null,
  isbn: null,
  cover_url: null,
};

describe("mergeBookFieldsOnRescan", () => {
  it("titre et catégorie viennent TOUJOURS de l'input (la validation de l'utilisateur fait foi)", () => {
    const payload = mergeBookFieldsOnRescan(existingFull, input({ title: "  Nouveau titre  ", category: "roman" }));
    expect(payload.title).toBe("Nouveau titre"); // trimé
    expect(payload.category).toBe("roman");
  });

  it("un champ existant non-null n'est JAMAIS écrasé par l'input", () => {
    const payload = mergeBookFieldsOnRescan(existingFull, input());
    expect(payload.series_name).toBe("Série existante");
    expect(payload.issue_number).toBe("1");
    expect(payload.authors).toBe("Auteur existant");
    expect(payload.publisher).toBe("Éditeur existant");
    expect(payload.page_count).toBe(100);
    expect(payload.isbn).toBe("9789999999999");
    expect(payload.cover_url).toBe("https://example.test/existing.jpg");
  });

  it("un NULL en base est comblé par l'input", () => {
    const payload = mergeBookFieldsOnRescan(existingEmpty, input());
    expect(payload.series_name).toBe("Série input");
    expect(payload.issue_number).toBe("3");
    expect(payload.authors).toBe("Auteur input");
    expect(payload.publisher).toBe("Éditeur input");
    expect(payload.page_count).toBe(200);
    expect(payload.isbn).toBe("9781234567890");
    expect(payload.cover_url).toBe("https://example.test/input.jpg");
  });

  it("un NULL en base ET un NULL en input restent NULL", () => {
    const payload = mergeBookFieldsOnRescan(existingEmpty, input({ authors: null, pageCount: null }));
    expect(payload.authors).toBeNull();
    expect(payload.page_count).toBeNull();
  });

  it("deleted_at est remis à null : le livre supprimé en douceur ressuscite", () => {
    const payload = mergeBookFieldsOnRescan(existingFull, input());
    expect(payload.deleted_at).toBeNull();
  });
});
