import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { DECODE_FORMATS, ZXING_OVERRIDES, type DecodeRequest, type DecodeResponse } from "./zxing-runtime";

/**
 * Le Worker de décodage (fluidité #332, item 2) : la conversion RGBA → gris
 * (en JS, 1 M de pixels par frame) et l'appel WASM synchrone (`tryHarder`
 * jusqu'à ~100 ms) tournaient sur le thread principal, 5 fois par seconde —
 * les taps de l'écran de scan saccadaient pendant la visée. Ici, le thread
 * principal ne fait plus que `drawImage` + `getImageData` et transfère les
 * pixels ; le décodage se fait à côté.
 *
 * Le binaire (1 Mo) part DÈS le démarrage du Worker (`fireImmediately`), en
 * parallèle de `getUserMedia` (item 1). Le rejet est avalé : le moteur mort se
 * détecte au premier décodage, côté scanner, avec un message.
 */
prepareZXingModule({ overrides: ZXING_OVERRIDES, fireImmediately: true }).catch(() => {});

// `self` est typé Window par le lib "dom" du projet ; le Worker n'a besoin que
// de ces deux membres, typés sur notre protocole.
const workerScope = self as unknown as {
  postMessage: (message: DecodeResponse) => void;
  onmessage: ((event: MessageEvent<DecodeRequest>) => void) | null;
};

workerScope.onmessage = async (event) => {
  const { id, width, height, pixels, tryHarder } = event.data;
  try {
    // zxing-wasm accepte tout objet { width, height, data } (duck typing) :
    // pas besoin du constructeur ImageData, absent des Workers de certains
    // navigateurs.
    const results = await readBarcodes(
      { width, height, data: new Uint8ClampedArray(pixels) } as ImageData,
      {
        formats: [...DECODE_FORMATS],
        // « Read » : le supplément est lu quand il est là, jamais exigé.
        eanAddOnSymbol: "Read",
        tryHarder,
        maxNumberOfSymbols: 1,
      },
    );
    workerScope.postMessage({ id, ok: true, codes: results.map((result) => ({ text: result.text, isValid: result.isValid })) });
  } catch (error) {
    workerScope.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
