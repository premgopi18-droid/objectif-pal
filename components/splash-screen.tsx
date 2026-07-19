"use client";

import { useEffect, useState } from "react";

/**
 * La splash d'ouverture (refonte #64) : le logo Objectif PAL sur le fond de
 * l'affiche de l'émission (#2e2357), affiché dès le premier rendu puis effacé
 * en fondu une fois l'app prête. Rendu visible côté serveur → présent
 * instantanément à l'ouverture, avant même l'hydratation. Sous
 * `prefers-reduced-motion`, on l'escamote sans fondu.
 */
const BRAND_BG = "#2e2357"; // le fond de l'affiche (échantillonné, cf. scripts/gen-brand.mjs)
const HOLD_MS = 650; // temps d'affichage plein avant le fondu
const FADE_MS = 400; // durée du fondu

export function SplashScreen() {
  const [phase, setPhase] = useState<"visible" | "fading" | "done">("visible");

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setPhase("done");
      return;
    }
    const toFade = setTimeout(() => setPhase("fading"), HOLD_MS);
    const toDone = setTimeout(() => setPhase("done"), HOLD_MS + FADE_MS);
    return () => {
      clearTimeout(toFade);
      clearTimeout(toDone);
    };
  }, []);

  if (phase === "done") return null;

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "grid",
        placeItems: "center",
        background: BRAND_BG,
        opacity: phase === "fading" ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: "none",
      }}
    >
      {/* Le logo complet (emblème + « OBJECTIF PAL »). <img> simple : une splash
          n'a pas besoin de l'optimiseur, et on la veut peinte au plus tôt. */}
      <img src="/brand/logo-full.png" alt="" style={{ width: "min(78vw, 460px)", height: "auto" }} />
    </div>
  );
}
