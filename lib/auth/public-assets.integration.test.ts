import { describe, expect, it } from "vitest";

/**
 * Test d'INTÉGRATION contre la PROD (INTEGRATION=1 npm test) — le contrat
 * anti-régression de l'issue #60, côté déploiement réel : les ressources que
 * le navigateur ou le service worker récupèrent SANS session doivent répondre
 * en clair, jamais par une redirection d'auth. C'est exactement le test qui
 * aurait attrapé le scanner mort le jour même : le proxy redirigeait le
 * binaire WASM vers /login, et le SW précachait ce HTML comme binaire.
 */

const PRODUCTION_ORIGIN = "https://objectif-pal.vercel.app";
const WASM_MAGIC_BYTES = [0x00, 0x61, 0x73, 0x6d]; // "\0asm"

const integrationEnabled = process.env.INTEGRATION === "1";

// 30 s : réseau réel depuis un runner GitHub aux US — même contrainte que le
// test d'isolation RLS, même plafond.
const INTEGRATION_TIMEOUT_MS = 30000;

describe.skipIf(!integrationEnabled)("les ressources publiques par nécessité, en prod, sans cookies", () => {
  it("le binaire WASM du scanner répond 200 en vrai WASM — jamais une redirection d'auth", async () => {
    const response = await fetch(`${PRODUCTION_ORIGIN}/wasm/zxing_reader.wasm`, { redirect: "manual" });

    expect(response.status).toBe(200);
    const firstBytes = new Uint8Array((await response.arrayBuffer()).slice(0, 4));
    expect([...firstBytes]).toEqual(WASM_MAGIC_BYTES);
  }, INTEGRATION_TIMEOUT_MS);

  it("manifest et service worker répondent 200 sans session (installabilité PWA)", async () => {
    const [manifest, serviceWorker] = await Promise.all([
      fetch(`${PRODUCTION_ORIGIN}/manifest.webmanifest`, { redirect: "manual" }),
      fetch(`${PRODUCTION_ORIGIN}/sw.js`, { redirect: "manual" }),
    ]);

    expect(manifest.status).toBe(200);
    expect(serviceWorker.status).toBe(200);
  }, INTEGRATION_TIMEOUT_MS);
});
