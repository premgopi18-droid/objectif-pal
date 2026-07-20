import { describe, expect, it } from "vitest";
import { coverPhotoPath, inboxCoverPhotoPath, isHouseCoverPhotoUrl } from "./cover-photo";

/**
 * La frontière « photo maison vs couverture de source » (#47) : seule une
 * photo maison peut être reprise — le test verrouille la reconnaissance.
 */

const SUPABASE_URL = "https://exemple.supabase.co";
const HOUSE_URL = `${SUPABASE_URL}/storage/v1/object/public/covers/user-1/book-1.webp`;

describe("isHouseCoverPhotoUrl", () => {
  it("reconnaît une photo maison, avec ou sans version de cache", () => {
    expect(isHouseCoverPhotoUrl(HOUSE_URL, SUPABASE_URL)).toBe(true);
    expect(isHouseCoverPhotoUrl(`${HOUSE_URL}?v=1752940000000`, SUPABASE_URL)).toBe(true);
  });

  it("une couverture de source n'est JAMAIS une photo maison", () => {
    expect(isHouseCoverPhotoUrl("https://static.metron.cloud/media/issue/x.jpg", SUPABASE_URL)).toBe(false);
    expect(isHouseCoverPhotoUrl("https://covers.openlibrary.org/b/isbn/9782723488525-L.jpg", SUPABASE_URL)).toBe(false);
    // Même hôte Supabase mais un autre bucket : pas une photo de couverture.
    expect(isHouseCoverPhotoUrl(`${SUPABASE_URL}/storage/v1/object/public/autre/x.webp`, SUPABASE_URL)).toBe(false);
  });

  it("pas de couverture ou pas de config : false, sans crash", () => {
    expect(isHouseCoverPhotoUrl(null, SUPABASE_URL)).toBe(false);
    expect(isHouseCoverPhotoUrl(HOUSE_URL, undefined)).toBe(false);
  });
});

/**
 * Les deux chemins de stockage vivent dans le MÊME dossier `{user_id}/` (seul
 * qu'autorise la RLS d'écriture, #33). La photo de rafale (#108) n'a pas de
 * `book_id` : son préfixe `inbox-` garantit qu'elle ne piétine jamais la photo
 * d'un livre, et l'URL qui en découle reste une photo MAISON — donc reprenable.
 */
describe("chemins de stockage des couvertures", () => {
  it("la photo d'un livre : {user_id}/{book_id}.webp", () => {
    expect(coverPhotoPath("user-1", "book-1")).toBe("user-1/book-1.webp");
  });

  it("la photo de rafale reste dans le dossier de l'utilisateur, préfixée inbox-", () => {
    const path = inboxCoverPhotoPath("user-1", "photo-9");
    expect(path).toBe("user-1/inbox-photo-9.webp");
    // Le premier segment DOIT être l'user_id : c'est ce que vérifie la RLS.
    expect(path.split("/")[0]).toBe("user-1");
  });

  it("une photo de rafale ne peut pas heurter la photo d'un livre", () => {
    // Même si un id de photo valait un id de livre, le préfixe les sépare.
    expect(inboxCoverPhotoPath("user-1", "book-1")).not.toBe(coverPhotoPath("user-1", "book-1"));
  });

  it("l'URL publique d'une photo de rafale est reconnue comme photo maison (reprenable, #47)", () => {
    const url = `${SUPABASE_URL}/storage/v1/object/public/covers/${inboxCoverPhotoPath("user-1", "photo-9")}`;
    expect(isHouseCoverPhotoUrl(url, SUPABASE_URL)).toBe(true);
  });
});
