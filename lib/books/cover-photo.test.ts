import { describe, expect, it } from "vitest";
import { coverPhotoPath, inboxCoverPhotoPath, isHouseCoverPhotoUrl, isOwnHouseCoverPhotoUrl } from "./cover-photo";

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
 * Le cloisonnement de la RÉFÉRENCE (#180) : le bucket est public, toutes les
 * URLs se lisent — mais une URL soumise au serveur ne doit désigner qu'un
 * objet du dossier de l'appelant. Sans cette garde, un compte pourrait
 * s'approprier la photo d'un autre en la rejouant depuis un export.
 */
describe("isOwnHouseCoverPhotoUrl", () => {
  it("accepte la photo du dossier de l'appelant (livre ou rafale)", () => {
    expect(isOwnHouseCoverPhotoUrl(HOUSE_URL, "user-1", SUPABASE_URL)).toBe(true);
    const inboxUrl = `${SUPABASE_URL}/storage/v1/object/public/covers/user-1/inbox-abc.webp`;
    expect(isOwnHouseCoverPhotoUrl(inboxUrl, "user-1", SUPABASE_URL)).toBe(true);
  });

  it("refuse la photo du dossier d'un AUTRE utilisateur", () => {
    expect(isOwnHouseCoverPhotoUrl(HOUSE_URL, "user-2", SUPABASE_URL)).toBe(false);
    // Préfixe piégé : « user-1 » n'est pas « user-12 ».
    const other = `${SUPABASE_URL}/storage/v1/object/public/covers/user-12/book.webp`;
    expect(isOwnHouseCoverPhotoUrl(other, "user-1", SUPABASE_URL)).toBe(false);
  });

  it("refuse le contournement par segments ../ (review #183)", () => {
    // La chaîne brute contient bien « covers/user-1/ », mais l'URL résout
    // vers le dossier de user-2 — c'est l'URL PARSÉE qui fait foi.
    const traversal = `${SUPABASE_URL}/storage/v1/object/public/covers/user-1/../user-2/photo.webp`;
    expect(isOwnHouseCoverPhotoUrl(traversal, "user-1", SUPABASE_URL)).toBe(false);
    // Et la même, encodée.
    const encoded = `${SUPABASE_URL}/storage/v1/object/public/covers/user-1/%2E%2E/user-2/photo.webp`;
    expect(isOwnHouseCoverPhotoUrl(encoded, "user-1", SUPABASE_URL)).toBe(false);
  });

  it("refuse ce qui n'est pas une photo maison, et ne crashe jamais", () => {
    expect(isOwnHouseCoverPhotoUrl("https://covers.openlibrary.org/b/isbn/x-L.jpg", "user-1", SUPABASE_URL)).toBe(false);
    expect(isOwnHouseCoverPhotoUrl(null, "user-1", SUPABASE_URL)).toBe(false);
    expect(isOwnHouseCoverPhotoUrl(HOUSE_URL, "user-1", undefined)).toBe(false);
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
