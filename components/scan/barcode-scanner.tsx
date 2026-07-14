"use client";

import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType, ResultMetadataType } from "@zxing/library";
import { useEffect, useRef, useState } from "react";

/**
 * La caméra qui lit les codes-barres — ZXing, parce que `BarcodeDetector`
 * natif ne renvoie JAMAIS le supplément de 5 chiffres (specs §5.3), et que le
 * supplément d'un fascicule contient le numéro d'issue. Quand ZXing le capte,
 * on le colle au code ; sinon la cascade se débrouille par préfixe.
 */

type BarcodeScannerProps = {
  onCode: (code: string) => void;
};

export function BarcodeScanner({ onCode }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraError, setCameraError] = useState(false);
  // Un scan continu émet plusieurs fois le même code : on ne remonte que le premier.
  const hasEmittedRef = useRef(false);

  useEffect(() => {
    if (!videoRef.current) return;
    hasEmittedRef.current = false;

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.UPC_A,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_E,
    ]);
    // Le supplément de 2 ou 5 chiffres, si ZXing arrive à le cadrer.
    hints.set(DecodeHintType.ALLOWED_EAN_EXTENSIONS, [5, 2]);

    const reader = new BrowserMultiFormatReader(hints);
    let controls: IScannerControls | undefined;

    reader
      .decodeFromVideoDevice(undefined, videoRef.current, (result) => {
        if (!result || hasEmittedRef.current) return;
        const extension = result.getResultMetadata()?.get(ResultMetadataType.UPC_EAN_EXTENSION);
        const code = `${result.getText()}${typeof extension === "string" ? extension : ""}`;
        hasEmittedRef.current = true;
        onCode(code);
      })
      .then((scannerControls) => {
        controls = scannerControls;
      })
      .catch(() => setCameraError(true));

    return () => controls?.stop();
  }, [onCode]);

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
    </div>
  );
}
