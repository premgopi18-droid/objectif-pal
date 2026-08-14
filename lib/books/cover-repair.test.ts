import { describe, expect, it } from "vitest";
import { decideCoverRepair, isKnownCoverImageUrl, isRepairAttemptFresh } from "./cover-repair";

const DEAD_URL = "https://images.epagine.fr/963/9791026820963_1_75.jpg";
const NEW_URL = "https://covers.openlibrary.org/b/isbn/9791026820963-L.jpg";

describe("la décision de réparation d'une couverture cassée (#53)", () => {
  it("une autre couverture trouvée : on remplace", () => {
    expect(decideCoverRepair(DEAD_URL, NEW_URL, null)).toEqual({ action: "replace", coverUrl: NEW_URL });
  });

  it("la chaîne rend la MÊME URL : le provider la dit vivante — l'échec était côté client, on garde", () => {
    expect(decideCoverRepair(DEAD_URL, DEAD_URL, null)).toEqual({ action: "keep" });
  });

  it("rien trouvé + URL confirmée morte : retour à « sans couverture » (la photo #33 prend le relais)", () => {
    expect(decideCoverRepair(DEAD_URL, null, false)).toEqual({ action: "clear" });
  });

  it("rien trouvé mais l'URL répond encore : on ne détruit pas (l'échec était transitoire)", () => {
    expect(decideCoverRepair(DEAD_URL, null, true)).toEqual({ action: "keep" });
  });

  it("rien trouvé et vérification impossible (réseau) : le doute profite à l'existant", () => {
    expect(decideCoverRepair(DEAD_URL, null, null)).toEqual({ action: "keep" });
  });
});

describe("la garde SSRF de la re-vérification (review #57)", () => {
  it("accepte les hôtes de couverture connus, en https", () => {
    expect(isKnownCoverImageUrl("https://images.epagine.fr/963/x.jpg")).toBe(true);
    expect(isKnownCoverImageUrl("https://covers.openlibrary.org/b/isbn/x-L.jpg")).toBe(true);
    expect(isKnownCoverImageUrl("https://openapi.bnf.fr/couverture/image/image/recupererImage?ISBN=x")).toBe(true);
    expect(isKnownCoverImageUrl("https://books.googleusercontent.com/x")).toBe(true);
  });

  it("refuse tout le reste : hôte inconnu, http clair, cible interne, URL invalide", () => {
    expect(isKnownCoverImageUrl("https://example.com/cover.jpg")).toBe(false);
    expect(isKnownCoverImageUrl("http://images.epagine.fr/963/x.jpg")).toBe(false);
    expect(isKnownCoverImageUrl("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isKnownCoverImageUrl("https://evil.com/?fake=images.epagine.fr")).toBe(false);
    expect(isKnownCoverImageUrl("pas-une-url")).toBe(false);
  });
});

/**
 * L'anti-boucle persistante (#177) : le tampon en base fait foi, avec TTL —
 * le Set mémoire du client n'était qu'une protection de session.
 */
describe("isRepairAttemptFresh", () => {
  const NOW = Date.parse("2026-08-14T12:00:00Z");

  it("une tentative récente interdit d'en repayer une", () => {
    expect(isRepairAttemptFresh("2026-08-14T11:00:00Z", NOW)).toBe(true);
    expect(isRepairAttemptFresh("2026-08-08T12:00:01Z", NOW)).toBe(true);
  });

  it("passé le TTL (7 j), on retente — les crans de repli s'étoffent", () => {
    expect(isRepairAttemptFresh("2026-08-07T11:59:59Z", NOW)).toBe(false);
  });

  it("jamais tentée, ou horodatage invalide : on tente", () => {
    expect(isRepairAttemptFresh(null, NOW)).toBe(false);
    expect(isRepairAttemptFresh("pas-une-date", NOW)).toBe(false);
  });
});
