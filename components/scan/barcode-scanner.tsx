"use client";

import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType, ResultMetadataType } from "@zxing/library";
import { useEffect, useRef, useState } from "react";

/**
 * La caméra qui lit les codes-barres — ZXing, parce que `BarcodeDetector`
 * natif ne renvoie JAMAIS le supplément de 5 chiffres (specs §5.3), et que le
 * supplément d'un fascicule contient le numéro d'issue.
 *
 * Le supplément est minuscule et rarement décodé sur la même frame que le
 * code principal : quand un code arrive SANS supplément, on n'émet pas tout
 * de suite — on laisse une fenêtre de grâce pour qu'une frame suivante
 * l'attrape. S'il n'arrive pas, les 12 chiffres partent seuls et la cascade
 * par préfixe prend le relais (on ne peut jamais compter sur le supplément).
 */

const SUPPLEMENT_GRACE_MILLISECONDS = 1500;

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
  // onCode dans une ref : le redémarrage de la caméra à chaque render serait
  // bien plus coûteux qu'une callback fraîche.
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  useEffect(() => {
    if (!videoRef.current) return;
    hasEmittedRef.current = false;

    const emit = (code: string) => {
      if (hasEmittedRef.current) return;
      hasEmittedRef.current = true;
      if (pendingRef.current) clearTimeout(pendingRef.current.timer);
      pendingRef.current = null;
      onCodeRef.current(code);
    };

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.UPC_A,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_E,
    ]);
    // Le supplément de 2 ou 5 chiffres, si ZXing arrive à le cadrer.
    hints.set(DecodeHintType.ALLOWED_EAN_EXTENSIONS, [5, 2]);
    hints.set(DecodeHintType.TRY_HARDER, true);

    const reader = new BrowserMultiFormatReader(hints);
    let controls: IScannerControls | undefined;

    reader
      .decodeFromVideoDevice(undefined, videoRef.current, (result) => {
        if (!result || hasEmittedRef.current) return;

        const mainCode = result.getText();
        const extension = result.getResultMetadata()?.get(ResultMetadataType.UPC_EAN_EXTENSION);

        // Supplément décodé : c'est la lecture parfaite, on part tout de suite.
        if (typeof extension === "string" && extension.length > 0) {
          emit(`${mainCode}${extension}`);
          return;
        }

        // Sans supplément : fenêtre de grâce. Une frame suivante l'aura peut-être.
        if (!pendingRef.current) {
          setPendingDisplay(mainCode);
          pendingRef.current = {
            code: mainCode,
            timer: setTimeout(() => pendingRef.current && emit(pendingRef.current.code), SUPPLEMENT_GRACE_MILLISECONDS),
          };
        } else {
          // On suit le dernier code vu (l'utilisateur a pu changer de bouquin).
          pendingRef.current.code = mainCode;
        }
      })
      .then((scannerControls) => {
        controls = scannerControls;
      })
      .catch(() => setCameraError(true));

    return () => {
      if (pendingRef.current) clearTimeout(pendingRef.current.timer);
      pendingRef.current = null;
      controls?.stop();
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
          Code lu — cadre aussi les petits chiffres à droite…
        </p>
      )}
    </div>
  );
}
