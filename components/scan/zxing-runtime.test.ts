import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ZXING_WASM_URL } from "./zxing-runtime";

/**
 * Le contrat #60, étendu au Worker (fluidité #332, item 2) : le binaire WASM a
 * UNE adresse, servie par nous, précachée par le service worker — et le
 * Worker de décodage la lit au même endroit que le repli du thread principal.
 * Ces règles se cassent en silence (le scanner devient muet, aucun test
 * fonctionnel ne bronche) : d'où des assertions sur la forme du code.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("le binaire WASM du scanner — une seule adresse, partout", () => {
  it("est l'adresse que postinstall produit (scripts/copy-zxing-wasm.mjs)", () => {
    const copyScript = read("../../scripts/copy-zxing-wasm.mjs");
    expect(copyScript).toMatch(/"public",\s*"wasm"/);
    expect(copyScript).toMatch(/"zxing_reader\.wasm"/);
    expect(ZXING_WASM_URL).toBe("/wasm/zxing_reader.wasm");
  });

  it("est précachée par le service worker (public/sw.js, SHELL_ASSETS)", () => {
    expect(read("../../public/sw.js")).toContain(`"${ZXING_WASM_URL}"`);
  });

  it("le Worker de décodage et le repli du thread principal lisent tous deux ZXING_OVERRIDES — jamais une URL en dur", () => {
    for (const file of ["./barcode-decoder.worker.ts", "./barcode-decoder-client.ts"]) {
      const source = read(file);
      expect(source).toContain("ZXING_OVERRIDES");
      expect(source).not.toContain("zxing_reader.wasm");
    }
    expect(read("./barcode-scanner.tsx")).not.toContain("zxing_reader.wasm");
  });

  it("le Worker précharge le binaire dès son démarrage (fireImmediately), en parallèle de la caméra", () => {
    expect(read("./barcode-decoder.worker.ts")).toMatch(/fireImmediately:\s*true/);
  });
});
