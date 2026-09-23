import { DECODE_FORMATS, ZXING_OVERRIDES, type DecodedCode, type DecodeRequest, type DecodeResponse } from "./zxing-runtime";

/**
 * Le décodeur vu du scanner (fluidité #332, item 2) : un Worker, et un REPLI
 * sur le thread principal si le Worker ne peut pas démarrer (navigateur sans
 * Worker de module, script introuvable, CSP) — le scanner ne doit jamais
 * mourir en silence pour une question de plomberie (post-mortem #60). Une
 * seule frame en vol à la fois (le scanner s'en assure), mais le protocole
 * porte un id : une réponse en retard ne se marie jamais à la mauvaise frame.
 */
export type BarcodeDecoder = {
  decode(imageData: ImageData, tryHarder: boolean): Promise<DecodedCode[]>;
  dispose(): void;
};

export function createBarcodeDecoder(): BarcodeDecoder {
  let worker: Worker | null = null;
  let mainThread: Promise<typeof import("zxing-wasm/reader")> | null = null;
  let nextId = 0;
  const pending = new Map<number, { resolve: (codes: DecodedCode[]) => void; reject: (error: Error) => void }>();

  const rejectAllPending = (error: Error) => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };

  const loadMainThread = () => {
    mainThread ??= import("zxing-wasm/reader").then((module) => {
      module.prepareZXingModule({ overrides: ZXING_OVERRIDES });
      return module;
    });
    return mainThread;
  };

  if (typeof Worker !== "undefined") {
    try {
      worker = new Worker(new URL("./barcode-decoder.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<DecodeResponse>) => {
        const entry = pending.get(event.data.id);
        if (!entry) return;
        pending.delete(event.data.id);
        if (event.data.ok) entry.resolve(event.data.codes);
        else entry.reject(new Error(event.data.error));
      };
      // Le Worker ne démarre pas (script, CSP, réseau) : on bascule sur le
      // thread principal pour la suite — le décodage continue, plus lent.
      worker.onerror = (event) => {
        console.error("[scan] le Worker de décodage a échoué, repli sur le thread principal :", event.message);
        worker?.terminate();
        worker = null;
        rejectAllPending(new Error(event.message || "worker"));
      };
    } catch (error) {
      console.error("[scan] Worker de décodage indisponible, décodage sur le thread principal :", error);
      worker = null;
    }
  }

  const decodeOnMainThread = async (imageData: ImageData, tryHarder: boolean): Promise<DecodedCode[]> => {
    const { readBarcodes } = await loadMainThread();
    const results = await readBarcodes(imageData, {
      formats: [...DECODE_FORMATS],
      eanAddOnSymbol: "Read",
      tryHarder,
      maxNumberOfSymbols: 1,
    });
    return results.map((result) => ({ text: result.text, isValid: result.isValid }));
  };

  return {
    decode(imageData, tryHarder) {
      if (!worker) return decodeOnMainThread(imageData, tryHarder);
      const id = ++nextId;
      // Les pixels sont TRANSFÉRÉS (zéro copie) : `imageData` est inutilisable
      // après — le scanner en produit une neuve à chaque frame.
      const pixels = imageData.data.buffer as ArrayBuffer;
      const request: DecodeRequest = { id, width: imageData.width, height: imageData.height, pixels, tryHarder };
      return new Promise<DecodedCode[]>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker?.postMessage(request, [pixels]);
      });
    },
    dispose() {
      worker?.terminate();
      worker = null;
      rejectAllPending(new Error("disposed"));
    },
  };
}
