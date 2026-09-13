import { describe, expect, it } from "vitest";
import { contributionLabel, deriveShareState } from "./share-state";

const SUPABASE_URL = "https://exemple.supabase.co";
const BUCKET = `${SUPABASE_URL}/storage/v1/object/public/covers`;
const PHOTO_URL = `${BUCKET}/user-1/book-1.webp?v=1`;
const INTERNALIZED_URL = `${BUCKET}/user-1/cover-book-1.webp?v=2`;
const SHARED_URL = `${BUCKET}/shared/9782070342266/abc.webp`;
const EXTERNAL_URL = "https://static.metron.cloud/x.jpg";

describe("deriveShareState (#278)", () => {
  it("une photo est partageable, décochée par défaut", () => {
    expect(deriveShareState({ coverUrl: PHOTO_URL, barcodeRaw: "9782070342266", sharedSourceCoverUrl: null, supabaseUrl: SUPABASE_URL })).toEqual({
      shareable: true,
      shared: false,
      defaultChecked: false,
      stale: false,
    });
  });

  it("une rapatriée est partageable, cochée par défaut", () => {
    const state = deriveShareState({ coverUrl: INTERNALIZED_URL, barcodeRaw: "9782070342266", sharedSourceCoverUrl: null, supabaseUrl: SUPABASE_URL });
    expect(state.shareable).toBe(true);
    expect(state.defaultChecked).toBe(true);
  });

  it("partagée quand la contribution vivante reflète CETTE couverture ; périmée sinon", () => {
    expect(deriveShareState({ coverUrl: PHOTO_URL, barcodeRaw: "x", sharedSourceCoverUrl: PHOTO_URL, supabaseUrl: SUPABASE_URL })).toMatchObject({ shared: true, stale: false });
    expect(deriveShareState({ coverUrl: PHOTO_URL, barcodeRaw: "x", sharedSourceCoverUrl: `${BUCKET}/user-1/book-1.webp?v=0`, supabaseUrl: SUPABASE_URL })).toMatchObject({ shared: false, stale: true });
  });

  it("pas partageable : sans code, sans couverture, couverture externe, ou déjà une copie du pool", () => {
    const none = { shareable: false, shared: false, defaultChecked: false, stale: false };
    expect(deriveShareState({ coverUrl: PHOTO_URL, barcodeRaw: null, sharedSourceCoverUrl: null, supabaseUrl: SUPABASE_URL })).toEqual(none);
    expect(deriveShareState({ coverUrl: null, barcodeRaw: "x", sharedSourceCoverUrl: null, supabaseUrl: SUPABASE_URL })).toEqual(none);
    expect(deriveShareState({ coverUrl: EXTERNAL_URL, barcodeRaw: "x", sharedSourceCoverUrl: null, supabaseUrl: SUPABASE_URL })).toEqual(none);
    expect(deriveShareState({ coverUrl: SHARED_URL, barcodeRaw: "x", sharedSourceCoverUrl: null, supabaseUrl: SUPABASE_URL })).toEqual(none);
  });
});

describe("contributionLabel", () => {
  it("le pseudo quand le cercle est rejoint, l'anonymat sinon", () => {
    expect(contributionLabel("Léna")).toBe("Photo de Léna");
    expect(contributionLabel(null)).toBe("Photo d'un·e lecteur·ice");
    expect(contributionLabel("  ")).toBe("Photo d'un·e lecteur·ice");
  });
});
