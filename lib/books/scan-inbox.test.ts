import { describe, expect, it } from "vitest";
import { formatDismissOutcome, sortByCompletionEffort, toScanInboxDraft, type ScanInboxItem } from "./scan-inbox";

/**
 * La boîte de finition lit du **jsonb non typé** : `resolved_metadata` est un
 * brouillon laissé par une source qui n'a répondu qu'à moitié, pas un contrat.
 * Ces tests fixent la règle : une forme inattendue donne un formulaire à
 * remplir, jamais une erreur ni un « undefined » affiché à l'écran.
 */

let counter = 0;

function item(overrides: Partial<ScanInboxItem> = {}): ScanInboxItem {
  counter += 1;
  return {
    id: `item-${counter}`,
    barcode_raw: "9782205087246",
    barcode_type: "isbn",
    cover_url: null,
    resolved_metadata: null,
    intent: "own",
    owned_since: null,
    finished_at: null,
    created_at: `2026-07-20T10:0${counter % 10}:00Z`,
    ...overrides,
  };
}

describe("toScanInboxDraft — le brouillon de finition", () => {
  it("sans métadonnées : tout est vide, le code et la couverture sont gardés", () => {
    const draft = toScanInboxDraft(item({ cover_url: "https://example.test/cover.jpg" }));
    expect(draft.title).toBe("");
    expect(draft.seriesName).toBeNull();
    expect(draft.category).toBeNull();
    // Le pont de re-résolution (§7) et la couverture montrée au scan survivent.
    expect(draft.barcodeRaw).toBe("9782205087246");
    expect(draft.coverUrl).toBe("https://example.test/cover.jpg");
  });

  it("pré-remplit ce que la cascade avait trouvé", () => {
    const draft = toScanInboxDraft(
      item({
        resolved_metadata: {
          title: "Le Chat du Rabbin",
          seriesName: "Le Chat du Rabbin",
          issueNumber: "1",
          authors: "Joann Sfar",
          publisher: "Dargaud",
          pageCount: 152,
          suggestedCategory: "bd",
        },
      }),
    );
    expect(draft.title).toBe("Le Chat du Rabbin");
    expect(draft.pageCount).toBe(152);
    expect(draft.category).toBe("bd");
    expect(draft.authors).toBe("Joann Sfar");
  });

  it("ignore les valeurs d'un type inattendu au lieu de les afficher", () => {
    // Le cas réel : une source rend un nombre là où on attend du texte, ou une
    // structure imbriquée. Sans garde, l'écran afficherait « [object Object] ».
    const draft = toScanInboxDraft(
      item({
        resolved_metadata: { title: 42, seriesName: { nested: true }, authors: ["a", "b"], pageCount: "beaucoup" },
      }),
    );
    expect(draft.title).toBe("");
    expect(draft.seriesName).toBeNull();
    expect(draft.authors).toBeNull();
    expect(draft.pageCount).toBeNull();
  });

  it("rejette une catégorie qui n'est pas du barème", () => {
    // Elle détermine les points (§3) : hors de question d'en accepter une
    // inventée par une source, même si elle ressemble à une catégorie.
    const draft = toScanInboxDraft(item({ resolved_metadata: { suggestedCategory: "graphic-novel" } }));
    expect(draft.category).toBeNull();
  });

  it("ne prend pas un nombre de pages nul ou négatif", () => {
    expect(toScanInboxDraft(item({ resolved_metadata: { pageCount: 0 } })).pageCount).toBeNull();
    expect(toScanInboxDraft(item({ resolved_metadata: { pageCount: -3 } })).pageCount).toBeNull();
  });

  it("les chaînes vides ou en espaces valent « pas de valeur »", () => {
    const draft = toScanInboxDraft(item({ resolved_metadata: { title: "   ", publisher: "" } }));
    expect(draft.title).toBe("");
    expect(draft.publisher).toBeNull();
  });

  it("un jsonb qui n'est pas un objet ne casse rien", () => {
    expect(toScanInboxDraft(item({ resolved_metadata: ["inattendu"] })).title).toBe("");
    expect(toScanInboxDraft(item({ resolved_metadata: "inattendu" })).title).toBe("");
  });

  it("un élément sans code-barres (photo seule) garde sa photo comme identité", () => {
    const draft = toScanInboxDraft(
      item({ barcode_raw: null, barcode_type: null, cover_url: "https://example.test/photo.jpg" }),
    );
    expect(draft.barcodeRaw).toBeNull();
    expect(draft.barcodeType).toBeNull();
    expect(draft.coverUrl).toBe("https://example.test/photo.jpg");
  });

  it("l'ISBN se déduit du code quand la source n'en donne pas", () => {
    expect(toScanInboxDraft(item()).isbn).toBe("9782205087246");
    // …mais pas d'un code UPC, qui n'est pas un ISBN.
    expect(toScanInboxDraft(item({ barcode_type: "upc", barcode_raw: "761941300221" })).isbn).toBeNull();
  });
});

describe("sortByCompletionEffort — vider la boîte vite", () => {
  it("les éléments déjà identifiés passent devant ceux à saisir entièrement", () => {
    const blank = item({ resolved_metadata: null, created_at: "2026-07-20T08:00:00Z" });
    const identified = item({ resolved_metadata: { title: "Akira" }, created_at: "2026-07-20T09:00:00Z" });
    const sorted = sortByCompletionEffort([blank, identified]);
    // L'identifié est pourtant plus RÉCENT : l'effort prime sur l'ancienneté.
    expect(sorted.map((entry) => entry.id)).toEqual([identified.id, blank.id]);
  });

  it("à effort égal, le plus ancien d'abord — on finit ce qu'on a commencé", () => {
    const older = item({ created_at: "2026-07-19T08:00:00Z" });
    const newer = item({ created_at: "2026-07-20T08:00:00Z" });
    expect(sortByCompletionEffort([newer, older]).map((entry) => entry.id)).toEqual([older.id, newer.id]);
  });

  it("ne mute pas la liste reçue", () => {
    const items = [item({ created_at: "2026-07-20T08:00:00Z" }), item({ created_at: "2026-07-19T08:00:00Z" })];
    const snapshot = items.map((entry) => entry.id);
    sortByCompletionEffort(items);
    expect(items.map((entry) => entry.id)).toEqual(snapshot);
  });
});

describe("formatDismissOutcome — le compte-rendu de l'écart groupé (#258)", () => {
  it("tout écarté : le compte, au pluriel qui va", () => {
    expect(formatDismissOutcome(3, 3)).toEqual({ kind: "all", message: "3 scans écartés" });
    expect(formatDismissOutcome(1, 1)).toEqual({ kind: "all", message: "1 scan écarté" });
  });

  it("écart partiel : on dit combien, sans inventer lesquels", () => {
    // L'UPDATE du lot est unique — le serveur connaît le compte, pas les ids
    // manquants : le message reste au niveau de ce qu'on sait vraiment.
    expect(formatDismissOutcome(4, 2)).toEqual({
      kind: "partial",
      message: "2 sur 4 écartés — les autres étaient déjà traités.",
    });
  });

  it("rien d'écarté : un fait annoncé, pas une erreur", () => {
    expect(formatDismissOutcome(2, 0)).toEqual({
      kind: "none",
      message: "Rien à écarter — ces éléments étaient déjà traités.",
    });
  });
});

describe("l'ISBN reconstitué du code (review #107)", () => {
  it("tronque le supplément prix : un ISBN fait 13 chiffres, pas 18", () => {
    // Le code scanné porte souvent 5 chiffres de supplément prix. Les garder
    // produirait un « ISBN » qui ne correspond à rien.
    const draft = toScanInboxDraft(item({ barcode_raw: "978220508724650695", barcode_type: "isbn" }));
    expect(draft.isbn).toBe("9782205087246");
    // Le code BRUT, lui, est conservé tel quel — c'est le pont de re-résolution (§7).
    expect(draft.barcodeRaw).toBe("978220508724650695");
  });

  it("un ISBN donné par la source l'emporte sur la reconstitution", () => {
    const draft = toScanInboxDraft(item({ resolved_metadata: { isbn: "9781234567897" } }));
    expect(draft.isbn).toBe("9781234567897");
  });
});
