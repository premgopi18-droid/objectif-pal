import { describe, expect, it } from "vitest";
import { deriveCoverSheetState } from "./sheet-state";

/**
 * La feuille « Changer la couverture » (#275) : quatre origines, et le retour
 * à l'automatique n'existe que s'il y a un choix à défaire.
 */

const SUPABASE_URL = "https://exemple.supabase.co";
const BUCKET = `${SUPABASE_URL}/storage/v1/object/public/covers`;
const PHOTO_URL = `${BUCKET}/user-1/book-1.webp?v=1`;
const INTERNALIZED_URL = `${BUCKET}/user-1/cover-book-1.webp`;
const EXTERNAL_URL = "https://static.metron.cloud/media/issue/x.jpg";

describe("deriveCoverSheetState", () => {
  it("sans couverture : placeholder, rien à défaire", () => {
    expect(deriveCoverSheetState({ coverUrl: null, coverChosenAt: null, supabaseUrl: SUPABASE_URL })).toEqual({
      origin: "none",
      label: "Pas encore de couverture",
      canReset: false,
    });
  });

  it("une photo maison est « Ma photo », choisie ou d'avant #275", () => {
    const chosen = deriveCoverSheetState({ coverUrl: PHOTO_URL, coverChosenAt: "2026-09-12T10:00:00Z", supabaseUrl: SUPABASE_URL });
    expect(chosen.origin).toBe("photo");
    expect(chosen.canReset).toBe(true);
    const legacy = deriveCoverSheetState({ coverUrl: PHOTO_URL, coverChosenAt: null, supabaseUrl: SUPABASE_URL });
    expect(legacy.origin).toBe("photo");
    // Rien à défaire : l'app ne l'a jamais remplacée, il n'y a pas de verrou.
    expect(legacy.canReset).toBe(false);
  });

  it("une couverture rapatriée (#208) non choisie est automatique — pas une photo", () => {
    const state = deriveCoverSheetState({ coverUrl: INTERNALIZED_URL, coverChosenAt: null, supabaseUrl: SUPABASE_URL });
    expect(state).toEqual({ origin: "automatic", label: "Couverture automatique", canReset: false });
  });

  it("une couverture de source choisie (lot B) est « choisie », avec retour possible", () => {
    const state = deriveCoverSheetState({ coverUrl: EXTERNAL_URL, coverChosenAt: "2026-09-12T10:00:00Z", supabaseUrl: SUPABASE_URL });
    expect(state).toEqual({ origin: "chosen", label: "Couverture choisie", canReset: true });
    // Rapatriée après coup par le job : toujours choisie.
    expect(deriveCoverSheetState({ coverUrl: INTERNALIZED_URL, coverChosenAt: "2026-09-12T10:00:00Z", supabaseUrl: SUPABASE_URL }).origin).toBe("chosen");
  });

  it("une couverture externe non choisie est automatique", () => {
    expect(deriveCoverSheetState({ coverUrl: EXTERNAL_URL, coverChosenAt: null, supabaseUrl: SUPABASE_URL }).origin).toBe("automatic");
  });
});
