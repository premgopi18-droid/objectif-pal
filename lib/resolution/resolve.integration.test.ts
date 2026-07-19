import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveScannedCode } from "./resolve";

/**
 * Tests d'INTÉGRATION — vraie base Supabase, vraies APIs (BnF, Google Books,
 * Metron), vrais codes-barres. Volontairement hors du run par défaut :
 *
 *   INTEGRATION=1 npm test
 *
 * (En local, le TLS peut être intercepté par l'antivirus : lancer avec
 * NODE_EXTRA_CA_CERTS pointant sur sa racine si besoin.)
 */

const integrationEnabled = process.env.INTEGRATION === "1";

// Vitest ne charge pas .env.local : on le fait nous-mêmes, comme gcd-load.mjs.
if (integrationEnabled) {
  const envFile = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
  for (const line of envFile.split("\n")) {
    const separator = line.indexOf("=");
    if (separator === -1 || line.startsWith("#")) continue;
    const key = line.slice(0, separator).trim();
    process.env[key] = process.env[key] ?? line.slice(separator + 1).trim();
  }
}

describe.skipIf(!integrationEnabled)("la cascade sur de vrais bouquins", () => {
  it("une BD franco-belge (Tintin, Casterman) se résout dans GCD, en base", async () => {
    // GCD stocke cet ISBN en ISBN-10 (220300102X) : le scan EAN-13 doit le
    // retrouver via la conversion du routeur.
    const result = await resolveScannedCode("9782203001022");
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.book.source).toBe("gcd");
      expect(result.book.suggestedCategory).toBe("bd");
      expect(result.book.publisher).toBe("Casterman");
    }
  }, 30000);

  it("un manga VF (Ki-oon) est identifié — GCD ou BnF selon le dump — en catégorie manga", async () => {
    const result = await resolveScannedCode("9791032700327");
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(["gcd", "bnf"]).toContain(result.book.source);
      expect(result.book.publisher?.toLowerCase()).toContain("ki-oon");
    }
  }, 30000);

  it("un UPC complet (Nightwing #123, cover A) résout l'issue exacte avec couverture Metron", async () => {
    const result = await resolveScannedCode("76194134174312311");
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.book.suggestedCategory).toBe("issue");
      expect(result.book.seriesName).toBe("Nightwing");
      expect(result.book.coverUrl).toBeTruthy();
    }
  }, 30000);

  it("une VARIANTE (cover B) résout la même issue, couverture via l'UPC normalisé", async () => {
    const result = await resolveScannedCode("76194134174312321");
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.book.seriesName).toBe("Nightwing");
      expect(result.book.issueNumber).toBe("123");
    }
  }, 30000);

  it("un indé absent de GCD mais chez Metron se résout par code complet (It's In Your Skin #1)", async () => {
    // Code réel scanné le 14/07/2026 : GCD n'a pas la ligne (préfixe partagé
    // seulement), Metron a le code exact.
    const result = await resolveScannedCode("70985304605900111");
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.book.source).toBe("metron");
      expect(result.book.issueNumber).toBe("1");
    }
  }, 30000);

  it("un préfixe seul (12 chiffres) rend « quel numéro ? » sur la série", async () => {
    const result = await resolveScannedCode("761941341743");
    expect(result.kind).toBe("pick-issue");
    if (result.kind === "pick-issue") {
      expect(result.seriesName).toBe("Nightwing");
      expect(result.issues.length).toBeGreaterThan(0);
    }
  }, 30000);

  it("le trou VF (Batman Urban Comics) obtient sa couverture — BnF Couvertures ou epagine", async () => {
    // Le cas mesuré du 19/07/2026 : fiche Google Books sans image, ISBN inconnu
    // d'OpenLibrary et d'Inventaire — la couverture ne peut venir que des
    // derniers crans. Vaut aussi pour une entrée déjà cachée sans couverture :
    // le rescan répare (même chemin de code).
    const result = await resolveScannedCode("9791026820963");
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.book.title).toContain("Batman");
      expect(result.book.coverUrl).toBeTruthy();
    }
  }, 45000);

  it("un livre absent de GCD est identifié (BnF ou Google Books) et le rescan sort du cache", async () => {
    // ISBN réel (une édition de L'Étranger, trouvée via la BnF elle-même),
    // vérifié absent de gcd_issues : la résolution est forcément externe,
    // donc le premier passage doit écrire barcode_cache.
    const first = await resolveScannedCode("9782754807685");
    expect(first.kind).toBe("resolved");
    if (first.kind === "resolved") expect(["bnf", "google_books"]).toContain(first.book.source);

    const second = await resolveScannedCode("9782754807685");
    expect(second.kind).toBe("resolved");
    if (second.kind === "resolved" && first.kind === "resolved") {
      // Le cache restitue la même source que la résolution d'origine.
      expect(second.book.source).toBe(first.book.source);
    }
  }, 45000);
});
