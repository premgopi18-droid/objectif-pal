import { describe, expect, it } from "vitest";
import { isHouseCoverPhotoUrl } from "./cover-photo";

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
