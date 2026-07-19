import { describe, expect, it } from "vitest";
import {
  deriveLibrary,
  filterLibraryEntries,
  sortLibraryEntries,
  type LibraryBookRow,
  type LibraryEntry,
} from "./derive-library";

const bookRow = (overrides: Partial<LibraryBookRow> = {}): LibraryBookRow => ({
  id: "book-1",
  title: "In waves",
  series_name: null,
  issue_number: null,
  category: "bd",
  cover_url: null,
  created_at: "2026-07-01T10:00:00Z",
  readings: [],
  purchases: [],
  ...overrides,
});

describe("la dérivation de la bibliothèque (#49)", () => {
  it("une lecture en cours domine tout — même un achat actif", () => {
    const [entry] = deriveLibrary([
      bookRow({
        readings: [{ status: "reading", deleted_at: null }],
        purchases: [{ deleted_at: null }],
      }),
    ]);
    expect(entry.status).toBe("reading");
  });

  it("terminé > possédé : un livre lu ET racheté s'affiche « Lu »", () => {
    const [entry] = deriveLibrary([
      bookRow({
        readings: [{ status: "finished", deleted_at: null }],
        purchases: [{ deleted_at: null }],
      }),
    ]);
    expect(entry.status).toBe("finished");
  });

  it("possédé non lu = dans la PAL — l'abandon n'en sort pas (§4.6)", () => {
    const [entry] = deriveLibrary([
      bookRow({
        readings: [{ status: "abandoned", deleted_at: null }],
        purchases: [{ deleted_at: null }],
      }),
    ]);
    expect(entry.status).toBe("in-pile");
  });

  it("abandonné sans possession reste « Abandonné »", () => {
    const [entry] = deriveLibrary([bookRow({ readings: [{ status: "abandoned", deleted_at: null }] })]);
    expect(entry.status).toBe("abandoned");
  });

  it("aucune trace active = « Sans activité » — l'angle mort que la vue rend visible", () => {
    const [entry] = deriveLibrary([
      bookRow({
        readings: [{ status: "finished", deleted_at: "2026-07-10T00:00:00Z" }],
        purchases: [{ deleted_at: "2026-07-10T00:00:00Z" }],
      }),
    ]);
    expect(entry.status).toBe("shelved");
    // Les traces supprimées ne comptent pas dans l'annonce du geste « retirer ».
    expect(entry.activeReadingCount).toBe(0);
    expect(entry.activePurchaseCount).toBe(0);
  });

  it("les embeds null (aucune ligne liée) sont traités comme vides", () => {
    const [entry] = deriveLibrary([bookRow({ readings: null, purchases: null })]);
    expect(entry.status).toBe("shelved");
  });
});

const entries: LibraryEntry[] = deriveLibrary([
  bookRow({ id: "a", title: "Astérix le Gaulois", series_name: "Astérix", created_at: "2026-07-01T00:00:00Z" }),
  bookRow({ id: "b", title: "In waves", created_at: "2026-07-15T00:00:00Z" }),
  bookRow({ id: "c", title: "Batman", series_name: "La Cour des Hiboux", created_at: "2026-07-10T00:00:00Z" }),
]);

describe("la recherche en mémoire", () => {
  it("matche le titre OU la série, sans casse ni accents (« asterix » trouve Astérix)", () => {
    expect(filterLibraryEntries(entries, "asterix").map((entry) => entry.bookId)).toEqual(["a"]);
    expect(filterLibraryEntries(entries, "HIBOUX").map((entry) => entry.bookId)).toEqual(["c"]);
  });

  it("une recherche vide rend tout, une recherche sans résultat rend vide", () => {
    expect(filterLibraryEntries(entries, "  ")).toHaveLength(3);
    expect(filterLibraryEntries(entries, "zzz")).toHaveLength(0);
  });
});

describe("le tri", () => {
  it("« récents » : derniers ajoutés d'abord ; « alphabétique » : titres en ordre français", () => {
    expect(sortLibraryEntries(entries, "recent").map((entry) => entry.bookId)).toEqual(["b", "c", "a"]);
    expect(sortLibraryEntries(entries, "alphabetical").map((entry) => entry.bookId)).toEqual(["a", "c", "b"]);
  });

  it("ne mute pas l'entrée (la liste d'origine reste dans son ordre)", () => {
    const before = entries.map((entry) => entry.bookId);
    sortLibraryEntries(entries, "alphabetical");
    expect(entries.map((entry) => entry.bookId)).toEqual(before);
  });
});
