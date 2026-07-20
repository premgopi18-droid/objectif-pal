import { describe, expect, it } from "vitest";
import { canMergeBooks, describeMergeConsequence, findMergeCandidates } from "./book-duplicates";
import type { LibraryEntry } from "@/lib/library/derive-library";

/**
 * La fusion touche à des faits (lectures, achats, possessions) et supprime un
 * livre : elle doit refuser tout ce dont elle n'est pas sûre. Les règles
 * testées ici sont **rejouées en SQL** par `merge_books` — ceci est la
 * première ligne, pas la garde.
 */

let counter = 0;

function entry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  counter += 1;
  return {
    bookId: `book-${counter}`,
    title: `Livre ${counter}`,
    seriesName: null,
    issueNumber: null,
    category: "bd",
    coverUrl: null,
    createdAt: "2026-07-01T10:00:00Z",
    status: "shelved",
    activeReadingCount: 0,
    activePurchaseCount: 0,
    isOwned: false,
    authors: null,
    publisher: null,
    pageCount: null,
    hasBarcode: false,
    ...overrides,
  };
}

describe("canMergeBooks — ce qu'on refuse de fusionner", () => {
  it("un livre avec lui-même", () => {
    const book = entry();
    expect(canMergeBooks(book, book)).toEqual({
      canMerge: false,
      reason: "Un livre ne se fusionne pas avec lui-même.",
    });
  });

  it("deux livres qui ont CHACUN un code-barres : deux éditions, pas un doublon", () => {
    // Et le piège derrière : l'unicité (user_id, barcode_raw) couvre les
    // supprimés, donc rescanner le doublon fusionné le ressusciterait (#10)
    // et déferait la fusion. Refuser vaut mieux que deviner.
    const verdict = canMergeBooks(entry({ hasBarcode: true }), entry({ hasBarcode: true }));
    expect(verdict.canMerge).toBe(false);
  });
});

describe("canMergeBooks — ce qu'on accepte", () => {
  it("deux saisies manuelles : LE cas réel du ticket", () => {
    // Sans code-barres, les NULL ne s'égalent pas : la contrainte d'unicité ne
    // les a pas bloquées à l'écriture (§7). C'est ici qu'on les réconcilie.
    expect(canMergeBooks(entry(), entry())).toEqual({ canMerge: true });
  });

  it("manuel × scanné : le conservé héritera du code-barres", () => {
    expect(canMergeBooks(entry({ hasBarcode: false }), entry({ hasBarcode: true })).canMerge).toBe(true);
  });
});

describe("findMergeCandidates", () => {
  it("ne propose jamais le livre conservé lui-même", () => {
    const keep = entry({ title: "Akira" });
    const candidates = findMergeCandidates(keep, [keep, entry({ title: "Akira" })], "");
    expect(candidates.map((candidate) => candidate.bookId)).not.toContain(keep.bookId);
  });

  it("écarte les livres qui ont leur propre code-barres", () => {
    const keep = entry({ hasBarcode: true });
    const scanned = entry({ hasBarcode: true });
    const manual = entry({ hasBarcode: false });
    const candidates = findMergeCandidates(keep, [scanned, manual], "");
    expect(candidates.map((candidate) => candidate.bookId)).toEqual([manual.bookId]);
  });

  it("met le titre IDENTIQUE en tête — c'est le doublon le plus probable", () => {
    const keep = entry({ title: "Akira" });
    const other = entry({ title: "Berserk" });
    const twin = entry({ title: "Akira" });
    const candidates = findMergeCandidates(keep, [other, twin], "");
    expect(candidates[0].bookId).toBe(twin.bookId);
  });

  it("la recherche est insensible à la casse et aux accents", () => {
    const keep = entry({ title: "Akira" });
    const target = entry({ title: "Les Météores" });
    const candidates = findMergeCandidates(keep, [target, entry({ title: "Berserk" })], "meteores");
    expect(candidates.map((candidate) => candidate.title)).toEqual(["Les Météores"]);
  });

  it("cherche aussi dans la série", () => {
    const keep = entry({ title: "Akira" });
    const target = entry({ title: "Tome 3", seriesName: "Blacksad" });
    const candidates = findMergeCandidates(keep, [target], "blacksad");
    expect(candidates).toHaveLength(1);
  });
});

describe("describeMergeConsequence — dire ce qu'on fait avant de le faire", () => {
  it("annonce les traces qui changent de livre", () => {
    const message = describeMergeConsequence(
      entry({ title: "Akira" }),
      entry({ title: "Akira (doublon)", activeReadingCount: 2, activePurchaseCount: 1 }),
    );
    expect(message).toContain("2 lecture(s) et 1 achat(s)");
    expect(message).toContain("« Akira »");
  });

  it("le dit aussi quand il n'y a rien à déplacer", () => {
    const message = describeMergeConsequence(entry(), entry());
    expect(message).toContain("aucune trace active");
  });

  it("annonce le transfert de code-barres, qui rend le conservé rescannable", () => {
    const message = describeMergeConsequence(entry({ hasBarcode: false }), entry({ hasBarcode: true }));
    expect(message).toContain("code-barres");
  });

  it("ne parle pas de code-barres quand le conservé en a déjà un", () => {
    const message = describeMergeConsequence(entry({ hasBarcode: true }), entry({ hasBarcode: false }));
    expect(message).not.toContain("code-barres");
  });
});
