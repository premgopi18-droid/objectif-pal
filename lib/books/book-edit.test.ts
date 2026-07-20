import { describe, expect, it } from "vitest";
import { prepareBookEdit, type BookEditInput } from "./book-edit";

/**
 * L'édition de fiche corrige des données qui **pèsent sur le score** (la
 * catégorie) et sur les stats (les pages). La validation est donc rejouée
 * côté serveur, et c'est elle qu'on teste ici — le formulaire n'est pas la
 * garde, il n'est que la première ligne.
 */

const input = (overrides: Partial<BookEditInput> = {}): BookEditInput => ({
  title: "Le Chat du Rabbin",
  seriesName: "Le Chat du Rabbin",
  issueNumber: "1",
  authors: "Joann Sfar",
  publisher: "Dargaud",
  pageCount: "152",
  category: "bd",
  ...overrides,
});

describe("prepareBookEdit — ce qu'on accepte", () => {
  it("normalise une saisie correcte", () => {
    const result = prepareBookEdit(input());
    expect(result).toEqual({
      ok: true,
      payload: {
        title: "Le Chat du Rabbin",
        series_name: "Le Chat du Rabbin",
        issue_number: "1",
        authors: "Joann Sfar",
        publisher: "Dargaud",
        page_count: 152,
        category: "bd",
      },
    });
  });

  it("les champs vides ou en espaces deviennent NULL, pas des chaînes vides", () => {
    // Une chaîne vide en base ferait apparaître « série :  » à l'écran et
    // fausserait les regroupements par série des stats (§4.5).
    const result = prepareBookEdit(input({ seriesName: "   ", authors: "", publisher: "  ", pageCount: "  " }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.series_name).toBeNull();
    expect(result.payload.authors).toBeNull();
    expect(result.payload.publisher).toBeNull();
    expect(result.payload.page_count).toBeNull();
  });

  it("le titre est rogné de ses espaces", () => {
    const result = prepareBookEdit(input({ title: "  Akira  " }));
    expect(result.ok && result.payload.title).toBe("Akira");
  });
});

describe("prepareBookEdit — ce qu'on refuse", () => {
  it("un titre vide : c'est le seul champ obligatoire", () => {
    expect(prepareBookEdit(input({ title: "   " }))).toEqual({
      ok: false,
      error: "Le titre est obligatoire.",
    });
  });

  it("une catégorie hors barème, même envoyée par notre propre formulaire", () => {
    // Elle détermine les points (§3) : on ne fait jamais confiance au client.
    const result = prepareBookEdit(input({ category: "graphic-novel" as never }));
    expect(result).toEqual({ ok: false, error: "Catégorie inconnue." });
  });

  it("un nombre de pages nul, négatif ou décimal", () => {
    for (const pageCount of ["0", "-3", "12.5"]) {
      const result = prepareBookEdit(input({ pageCount }));
      expect(result.ok, `pageCount=${pageCount}`).toBe(false);
    }
  });

  it("un nombre de pages qui n'est pas un nombre", () => {
    expect(prepareBookEdit(input({ pageCount: "beaucoup" })).ok).toBe(false);
  });
});
