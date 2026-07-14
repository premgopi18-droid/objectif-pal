"use client";

import { useEffect, useRef, useState } from "react";
import { readBarcodes } from "zxing-wasm/reader";

/**
 * La caméra qui lit les codes-barres — zxing-wasm (le ZXing C++ compilé en
 * WebAssembly), parce que ni `BarcodeDetector` natif ni le port JS de ZXing
 * ne savent lire le supplément de 5 chiffres — le port JS le tente mais son
 * décodeur d'extensions est cassé (prouvé sur image synthétique parfaite,
 * cf. barcode-decoding.test.ts). Or le supplément d'un fascicule contient le
 * numéro d'issue (specs §5.3).
 *
 * Le supplément reste rarement lisible sur la même frame que le code
 * principal : quand un code arrive SANS supplément, on n'émet pas tout de
 * suite — fenêtre de grâce, puis les 12 chiffres partent seuls et la cascade
 * par préfixe prend le relais.
 */

const SUPPLEMENT_GRACE_MILLISECONDS = 1500;
const DECODE_INTERVAL_MILLISECONDS = 180;

type BarcodeScannerProps = {
  onCode: (code: string) => void;
};

export function BarcodeScanner({ onCode }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraError, setCameraError] = useState(false);
  /** Le code lu, affiché pendant qu'on espère encore son supplément. */
  const [pendingDisplay, setPendingDisplay] = useState<string | null>(null);

  const hasEmittedRef = useRef(false);
  const pendingRef = useRef<{ code: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  // onCode dans une ref : redémarrer la caméra à chaque render serait bien
  // plus coûteux qu'une callback fraîche.
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    hasEmittedRef.current = false;

    let stream: MediaStream | undefined;
    let intervalId: ReturnType<typeof setInterval> | undefined;
    let isDecoding = false;
    const canvas = document.createElement("canvas");

    const emit = (code: string) => {
      if (hasEmittedRef.current) return;
      hasEmittedRef.current = true;
      if (pendingRef.current) clearTimeout(pendingRef.current.timer);
      pendingRef.current = null;
      onCodeRef.current(code);
    };

    const decodeFrame = async () => {
      if (isDecoding || hasEmittedRef.current || video.readyState < video.HAVE_CURRENT_DATA) return;
      isDecoding = true;
      try {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return;
        context.drawImage(video, 0, 0);
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

        const results = await readBarcodes(imageData, {
          formats: ["EAN-13", "UPC-A", "EAN-8", "UPC-E"],
          // « Read » : le supplément est lu quand il est là, jamais exigé.
          eanAddOnSymbol: "Read",
          tryHarder: true,
          maxNumberOfSymbols: 1,
        });
        const result = results[0];
        if (!result?.isValid) return;

        // zxing-cpp renvoie « principal<sep>supplément » : on ne garde que les chiffres.
        const digits = result.text.replace(/\D/g, "");
        const hasSupplement = digits.length >= 14;

        if (hasSupplement) {
          emit(digits);
        } else if (!pendingRef.current) {
          setPendingDisplay(digits);
          pendingRef.current = {
            code: digits,
            timer: setTimeout(() => pendingRef.current && emit(pendingRef.current.code), SUPPLEMENT_GRACE_MILLISECONDS),
          };
        } else {
          // On suit le dernier code vu (l'utilisateur a pu changer de bouquin).
          pendingRef.current.code = digits;
        }
      } catch {
        // Une frame qui ne décode pas n'est pas une erreur : la suivante arrive.
      } finally {
        isDecoding = false;
      }
    };

    navigator.mediaDevices
      .getUserMedia({
        // Résolution élevée exigée : les barres du supplément sont minuscules.
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      })
      .then((mediaStream) => {
        stream = mediaStream;
        video.srcObject = mediaStream;
        return video.play();
      })
      .then(() => {
        intervalId = setInterval(decodeFrame, DECODE_INTERVAL_MILLISECONDS);
      })
      .catch(() => setCameraError(true));

    return () => {
      if (intervalId) clearInterval(intervalId);
      if (pendingRef.current) clearTimeout(pendingRef.current.timer);
      pendingRef.current = null;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  if (cameraError) {
    return (
      <p role="alert" className="rounded-lg border border-foreground/20 p-4 text-sm opacity-80">
        La caméra est inaccessible (permission refusée ?). Tu peux saisir le code à la main ci-dessous.
      </p>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl bg-black">
      {/* muted + playsInline : indispensables pour l'autoplay mobile. */}
      <video ref={videoRef} className="aspect-[3/4] w-full object-cover" muted playsInline />
      {/* Le cadre de visée. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-lg border-2 border-amber-500/80" />
      {pendingDisplay && (
        <p className="absolute inset-x-0 bottom-3 text-center text-sm font-medium text-white/90">
          <code className="font-mono">{pendingDisplay}</code> — cadre aussi les petits chiffres à droite…
        </p>
      )}
    </div>
  );
}
