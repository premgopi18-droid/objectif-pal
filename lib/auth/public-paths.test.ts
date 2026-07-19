import { describe, expect, it } from "vitest";
import { isPublicPath } from "./public-paths";

/**
 * Le contrat anti-régression de l'issue #60 : chaque ressource que le
 * navigateur ou le service worker récupère SANS session doit être listée —
 * sinon la redirection d'auth se fait passer pour l'asset (vécu : le HTML de
 * /login précaché comme binaire WASM, scanner définitivement mort).
 */
describe("les chemins publics par nécessité (proxy d'auth)", () => {
  it("les ressources que le SW précache dès la page de login passent sans session", () => {
    expect(isPublicPath("/wasm/zxing_reader.wasm")).toBe(true);
    expect(isPublicPath("/icons/icon-192.png")).toBe(true);
    expect(isPublicPath("/manifest.webmanifest")).toBe(true);
    expect(isPublicPath("/sw.js")).toBe(true);
  });

  it("le parcours d'authentification passe sans session", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/auth/callback")).toBe(true);
  });

  it("les pages de l'app restent derrière le login", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/scan")).toBe(false);
    expect(isPublicPath("/journal")).toBe(false);
    expect(isPublicPath("/pal")).toBe(false);
    expect(isPublicPath("/bilan")).toBe(false);
  });
});
