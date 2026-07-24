import { describe, expect, it } from "vitest";
import {
  deriveLibrary,
  isInInventory,
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
  authors: null,
  publisher: null,
  page_count: null,
  barcode_raw: null,
  readings: [],
  purchases: [],
  // L'inventaire (#152) : la Biblio ne montre que le possédé — les fixtures
  // possèdent par défaut, les tests d'exclusion passent ownerships: [].
  ownerships: [{ owned_since: null, disposed_at: null, deleted_at: null }],
  ...overrides,
});

describe("la dérivation de la bibliothèque (#49)", () => {
  it("une lecture en cours domine tout — même un achat actif", () => {
    const [entry] = deriveLibrary([
      bookRow({
        readings: [{ status: "reading", started_at: null, finished_at: null, deleted_at: null }],
        purchases: [{ purchased_at: "2026-06-01", deleted_at: null }],
      }),
    ]);
    expect(entry.status).toBe("reading");
  });

  it("terminé > possédé : un livre lu ET racheté s'affiche « Lu »", () => {
    const [entry] = deriveLibrary([
      bookRow({
        readings: [{ status: "finished", started_at: null, finished_at: "2026-06-15", deleted_at: null }],
        purchases: [{ purchased_at: "2026-06-01", deleted_at: null }],
      }),
    ]);
    expect(entry.status).toBe("finished");
  });

  it("possédé non lu = dans la PAL — l'abandon n'en sort pas (§4.6)", () => {
    const [entry] = deriveLibrary([
      bookRow({
        readings: [{ status: "abandoned", started_at: null, finished_at: null, deleted_at: null }],
        purchases: [{ purchased_at: "2026-06-01", deleted_at: null }],
      }),
    ]);
    expect(entry.status).toBe("in-pile");
  });

  it("possédé abandonné : toujours « Dans la PAL » — l'abandon n'en sort pas (§4.6, #152)", () => {
    const [entry] = deriveLibrary([bookRow({ readings: [{ status: "abandoned", started_at: null, finished_at: null, deleted_at: null }] })]);
    expect(entry.status).toBe("in-pile");
  });

  it("possédé aux traces toutes supprimées : « Dans la PAL » — un possédé jamais fini est à lire (#152)", () => {
    const [entry] = deriveLibrary([
      bookRow({
        readings: [{ status: "finished", started_at: null, finished_at: "2026-06-15", deleted_at: "2026-07-10T00:00:00Z" }],
        purchases: [{ purchased_at: "2026-06-01", deleted_at: "2026-07-10T00:00:00Z" }],
      }),
    ]);
    expect(entry.status).toBe("in-pile");
    // Les traces supprimées ne comptent pas dans l'annonce du geste « retirer ».
    expect(entry.activeReadingCount).toBe(0);
    expect(entry.activePurchaseCount).toBe(0);
  });

  it("les embeds null (aucune ligne liée) sont traités comme vides", () => {
    const [entry] = deriveLibrary([bookRow({ readings: null, purchases: null })]);
    expect(entry.status).toBe("in-pile");
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

describe("la possession déclarée dans la bibliothèque (#101)", () => {
  const owns = (overrides: { ownedSince?: string | null; disposedAt?: string | null } = {}) => ({
    owned_since: overrides.ownedSince ?? null,
    disposed_at: overrides.disposedAt ?? null,
    deleted_at: null,
  });

  it("possédé sans achat = dans la PAL — l'angle mort de #49, enfin visible", () => {
    // Avant #101 ce livre s'affichait « Sans activité » : il n'avait pas
    // d'achat, donc la Biblio le croyait sans vie. C'est LE cas du ticket.
    const [entry] = deriveLibrary([bookRow({ ownerships: [owns()] })]);
    expect(entry.status).toBe("in-pile");
    expect(entry.isOwned).toBe(true);
  });

  it("possédé ET déjà lu (sans date) : « Lu », et plus dans la PAL", () => {
    const [entry] = deriveLibrary([
      bookRow({
        ownerships: [owns()],
        readings: [{ status: "finished", started_at: null, finished_at: null, deleted_at: null }],
      }),
    ]);
    expect(entry.status).toBe("finished");
    expect(entry.isOwned).toBe(true);
  });

  it("donné ou revendu : SORTI de la liste — « retirer » retire vraiment (#114)", () => {
    // Décision du 20/07/2026 : la Biblio raconte ce qu'on possède (et ce qu'on
    // a lu sans posséder). Un livre cédé la quitte ; son histoire — lectures,
    // points, mouvements — vit au journal, au bilan et aux stats, pas ici.
    expect(deriveLibrary([bookRow({ ownerships: [owns({ disposedAt: "2026-07-12" })] })])).toEqual([]);
  });

  it("acheté PUIS cédé : la possession fait autorité — sorti aussi (#114)", () => {
    // L'achat actif ne retient pas le livre dans la liste : elle seule sait
    // dire « je ne le possède plus » d'un livre pourtant acheté.
    const entries = deriveLibrary([
      bookRow({
        purchases: [{ purchased_at: "2026-06-01", deleted_at: null }],
        ownerships: [owns({ disposedAt: "2026-07-12" })],
      }),
    ]);
    expect(entries).toEqual([]);
  });

  it("cédé puis RACHETÉ : de retour dans la liste, en pile (#117)", () => {
    // Le filet du rachat (derivePileStatus) remet le livre en pile même si la
    // ligne de possession est restée close : la Biblio doit raconter la même
    // histoire que le volet Pile du même écran (review #118).
    const [entry] = deriveLibrary([
      bookRow({
        purchases: [{ purchased_at: "2027-01-10", deleted_at: null }],
        ownerships: [owns({ disposedAt: "2026-07-20" })],
      }),
    ]);
    expect(entry.status).toBe("in-pile");
    expect(entry.isOwned).toBe(true);
  });

  it("un emprunt lu SORT de l'inventaire (#152) — il vit au Journal, pas en Biblio", () => {
    const entries = deriveLibrary([
      bookRow({
        ownerships: [],
        readings: [{ status: "finished", started_at: null, finished_at: "2026-06-15", deleted_at: null }],
      }),
    ]);
    expect(entries).toEqual([]);
  });

  it("la règle de pile n'est pas réécrite ici : acquérir un déjà-lu n'entre pas en PAL (§3.3)", () => {
    // Le livre a été lu AVANT d'être acheté : le réducteur partagé refuse
    // l'entrée en pile, et la Biblio doit dire la même chose que la vue Pile.
    const [entry] = deriveLibrary([
      bookRow({
        purchases: [{ purchased_at: "2026-07-05", deleted_at: null }],
        readings: [{ status: "abandoned", started_at: null, finished_at: null, deleted_at: null }],
        ownerships: [owns({ ownedSince: "2026-07-05" })],
      }),
    ]);
    // Pas de fin ici : l'abandon ne sort pas de la pile, le livre y est bien.
    expect(entry.status).toBe("in-pile");
  });
});

describe("« Récents » = dernière activité (#146)", () => {
  it("la fiche d'avant-hier commencée hier remonte au-dessus de la rafale d'aujourd'hui... d'hier soir", () => {
    const [oldButActive, justCreated] = deriveLibrary([
      bookRow({
        id: "vieux-mais-actif",
        created_at: "2026-07-20T10:00:00Z",
        readings: [{ status: "reading", started_at: "2026-07-22", finished_at: null, deleted_at: null }],
      }),
      bookRow({ id: "fiche-neuve", created_at: "2026-07-21T09:00:00Z" }),
    ]);
    const sorted = sortLibraryEntries([justCreated, oldButActive], "recent");
    expect(sorted[0].bookId).toBe("vieux-mais-actif");
  });

  it("sans aucune activité, la création de fiche fait foi — comme avant", () => {
    const entries = deriveLibrary([
      bookRow({ id: "ancien", created_at: "2026-07-01T10:00:00Z" }),
      bookRow({ id: "recent", created_at: "2026-07-21T10:00:00Z" }),
    ]);
    const sorted = sortLibraryEntries(entries, "recent");
    expect(sorted[0].bookId).toBe("recent");
  });
});

describe("isInInventory (#160) — LA règle partagée Biblio/scan", () => {
  const reading = { status: "finished" as const, finished_at: "2026-06-15", deleted_at: null };
  it("le mensonge du scan, mort : fiche connue + lecture SANS possession = hors inventaire", () => {
    expect(isInInventory({ readings: [reading], purchases: [], ownerships: [] })).toBe(false);
  });
  it("possédé (déclaré ou acheté non cédé) = dedans ; cédé = dehors ; racheté après cession = dedans (#117)", () => {
    expect(isInInventory({ readings: [], purchases: [], ownerships: [{ owned_since: null, disposed_at: null, deleted_at: null }] })).toBe(true);
    expect(isInInventory({ readings: [], purchases: [{ purchased_at: "2026-06-01", deleted_at: null }], ownerships: [] })).toBe(true);
    expect(isInInventory({ readings: [], purchases: [], ownerships: [{ owned_since: null, disposed_at: "2026-07-20", deleted_at: null }] })).toBe(false);
    expect(isInInventory({ readings: [], purchases: [{ purchased_at: "2027-01-10", deleted_at: null }], ownerships: [{ owned_since: null, disposed_at: "2026-07-20", deleted_at: null }] })).toBe(true);
  });
});
