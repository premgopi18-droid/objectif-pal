import bwipjs from "bwip-js/node";
import { describe, expect, it } from "vitest";
import { readBarcodes } from "zxing-wasm/reader";

/**
 * Le test qui a tué zxing-js : sur un code-barres synthétique PARFAIT, son
 * décodeur d'extensions ne trouvait jamais le supplément de 5 chiffres
 * (NotFoundException à tous les offsets — 14/07/2026). zxing-wasm (le ZXing
 * C++ en WebAssembly) doit le lire — ce test verrouille le choix du moteur.
 *
 * Le supplément d'un fascicule contient le numéro d'issue (specs §5.3) :
 * sans lui, jamais de résolution « zéro question » sur les comics.
 */

async function generateBarcode(bcid: string, text: string): Promise<Uint8Array> {
  // Cast : les typages de bwip-js ne connaissent ni `addongap` (option BWIPP
  // pourtant réelle) ni l'overload promesse de toBuffer.
  const toBuffer = bwipjs.toBuffer as unknown as (options: Record<string, unknown>) => Promise<Buffer>;
  const buffer = await toBuffer({
    bcid,
    text,
    scale: 4,
    height: 20,
    includetext: false,
    // Zone de silence : sans marge blanche, aucun lecteur ne trouve les gardes.
    paddingwidth: 24,
    paddingheight: 12,
    backgroundcolor: "FFFFFF",
    // L'écart standard code → supplément (~9 modules). Mesuré : au-delà de
    // ~10, zxing-cpp ne cherche plus le supplément (fenêtre stricte).
    addongap: 9,
  });
  return new Uint8Array(buffer);
}

const decode = async (image: Uint8Array) =>
  readBarcodes(image, {
    formats: ["EAN-13", "UPC-A", "EAN-8", "UPC-E"],
    eanAddOnSymbol: "Read",
    tryHarder: true,
    maxNumberOfSymbols: 1,
  });

describe("le décodage des codes-barres (zxing-wasm)", () => {
  it("lit un UPC-A AVEC son supplément de 5 chiffres — le cas comics", async () => {
    const results = await decode(await generateBarcode("upca", "76194134174 12321"));
    expect(results[0]?.isValid).toBe(true);
    // zxing-cpp rend l'UPC-A en forme EAN-13 (zéro de tête) et concatène le
    // supplément : 1 + 12 + 5 = 18 chiffres. Le routeur retire le zéro.
    expect(results[0].text.replace(/\D/g, "")).toBe("076194134174312321");
  });

  it("lit un EAN-13 avec supplément (le prix d'un livre, jeté ensuite par le routeur)", async () => {
    const results = await decode(await generateBarcode("ean13", "9780439420891 51095"));
    expect(results[0]?.isValid).toBe(true);
    expect(results[0].text.replace(/\D/g, "")).toBe("978043942089151095");
  });

  it("lit un UPC-A sans supplément (le supplément n'est jamais exigé)", async () => {
    const results = await decode(await generateBarcode("upca", "76194134174"));
    expect(results[0]?.isValid).toBe(true);
    expect(results[0].text.replace(/\D/g, "")).toBe("0761941341743");
  });
});
