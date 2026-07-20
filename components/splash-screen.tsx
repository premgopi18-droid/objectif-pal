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
    // Sous reduced-motion : escamotage immédiat (délais à 0), sans fondu. Les
    // setState passent par des timers (jamais synchrones dans l'effet — règle
    // react-hooks/set-state-in-effect).
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const hold = reduced ? 0 : HOLD_MS;
    const fade = reduced ? 0 : FADE_MS;
    const toFade = setTimeout(() => setPhase("fading"), hold);
    const toDone = setTimeout(() => setPhase("done"), hold + fade);
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
      <img src="/brand/logo-full.webp" alt="" style={{ width: "min(78vw, 460px)", height: "auto" }} />
    </div>
  );
}
