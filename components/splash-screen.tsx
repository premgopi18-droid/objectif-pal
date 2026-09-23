"use client";

import { useEffect, useState } from "react";

/**
 * La splash d'ouverture (refonte #64) : le logo Objectif PAL sur le fond de
 * l'affiche de l'émission (#2e2357), affiché dès le premier rendu puis effacé
 * en fondu une fois l'app prête. Rendu visible côté serveur → présent
 * instantanément à l'ouverture, avant même l'hydratation. Sous
 * `prefers-reduced-motion`, on l'escamote sans fondu.
 *
 * Fluidité #331 (item 6) : la sortie est LIÉE À L'HYDRATATION, plus à un
 * minuteur fixe. Avant : 650 ms de hold + 400 ms de fondu déclenchés à
 * l'hydratation, soit ~1 s de logo APRÈS que l'app était prête, qui
 * recouvrait même les squelettes (double transition). Maintenant : le logo
 * reste visible au moins MIN_VISIBLE_MS depuis le premier paint (le temps de
 * le lire — s'il est déjà là depuis plus longtemps, il part tout de suite),
 * puis fond en FADE_MS. Au plus ~700 ms au-delà du premier paint (hold plein
 * + fondu) quand l'hydratation est rapide ; quand elle est lente, le hold
 * tombe à 0 et il ne reste que les 300 ms de fondu — rien d'ajouté.
 */
const BRAND_BG = "#2e2357"; // le fond de l'affiche (échantillonné, cf. scripts/gen-brand.mjs)
/** Le logo reste lisible au moins ce temps depuis le premier paint, jamais plus longtemps que nécessaire. */
const MIN_VISIBLE_MS = 400;
const FADE_MS = 300; // durée du fondu
/** Dimensions intrinsèques de public/brand/logo-full.webp : le navigateur réserve la place, zéro saut. */
const LOGO_WIDTH = 920;
const LOGO_HEIGHT = 523;

/**
 * Depuis quand la splash est à l'écran. `first-contentful-paint` d'abord : la
 * splash EST le premier contenu peint (le logo), et c'est la seule entrée de
 * paint timing que WebKit expose (`first-paint` est propre à Chromium — sur
 * iPhone, la cible de la PWA, il n'existe pas ; review #338). Sans aucune
 * entrée, on considère qu'elle vient d'apparaître : le repli penche vers
 * « lisible », jamais vers « déjà vue ».
 */
function millisecondsVisible(): number {
  const paint =
    performance.getEntriesByName("first-contentful-paint")[0] ?? performance.getEntriesByName("first-paint")[0];
  return paint ? Math.max(0, performance.now() - paint.startTime) : 0;
}

export function SplashScreen() {
  const [phase, setPhase] = useState<"visible" | "fading" | "done">("visible");

  useEffect(() => {
    // Cet effet tourne À L'HYDRATATION : l'app est prête à répondre. Sous
    // reduced-motion : escamotage immédiat (délais à 0), sans fondu. Les
    // setState passent par des timers (jamais synchrones dans l'effet — règle
    // react-hooks/set-state-in-effect).
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const hold = reduced ? 0 : Math.max(0, MIN_VISIBLE_MS - millisecondsVisible());
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
          n'a pas besoin de l'optimiseur, et on la veut peinte au plus tôt —
          `fetchPriority="high"` le dit au navigateur, width/height réservent la place. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- splash : peinte avant l'hydratation, hors optimiseur */}
      <img
        src="/brand/logo-full.webp"
        alt=""
        width={LOGO_WIDTH}
        height={LOGO_HEIGHT}
        fetchPriority="high"
        style={{ width: "min(78vw, 460px)", height: "auto" }}
      />
    </div>
  );
}
