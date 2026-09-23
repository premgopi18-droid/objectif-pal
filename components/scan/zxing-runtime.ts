/**
 * Ce que le thread principal et le Worker de décodage partagent (fluidité
 * #332, item 2) : l'URL du binaire WASM, ses options, les formats lus, et le
 * protocole des messages.
 *
 * Le binaire est servi par NOUS (copié dans public/wasm/ par postinstall, cf.
 * scripts/copy-zxing-wasm.mjs), pas par le CDN jsDelivr : un CDN bloqué
 * rendait le scanner muet, sans aucun message. Le service worker le précache
 * (public/sw.js, SHELL_ASSETS) et le sert cache-first. Le contrat #60 exige
 * que cette URL reste la même partout — `zxing-runtime.test.ts` le vérifie.
 */
export const ZXING_WASM_URL = "/wasm/zxing_reader.wasm";

export const ZXING_OVERRIDES = {
  locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? ZXING_WASM_URL : prefix + path),
};

/** Les formats du scan : EAN-13 (ISBN), UPC-A (fascicules), et leurs formes courtes. */
export const DECODE_FORMATS = ["EAN-13", "UPC-A", "EAN-8", "UPC-E"] as const;

/** Une frame à décoder : les pixels RGBA de la bande centrale, transférés (zéro copie). */
export type DecodeRequest = {
  id: number;
  width: number;
  height: number;
  pixels: ArrayBuffer;
  /** `tryHarder` coûte ~2× de CPU : demandé tant qu'aucun code n'a été lu récemment. */
  tryHarder: boolean;
};

export type DecodedCode = { text: string; isValid: boolean };

export type DecodeResponse = { id: number; ok: true; codes: DecodedCode[] } | { id: number; ok: false; error: string };
