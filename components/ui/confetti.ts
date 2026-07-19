/**
 * La micro-pluie de confettis — « le moment de gloire » (design-specs §5, #73).
 * Un burst rituel au tap « Terminé ✓ » : quelques particules aux couleurs de la
 * palette qui jaillissent du bouton, retombent et s'effacent, via la Web
 * Animations API (comme le proto). Chaque particule se retire d'elle-même à la
 * fin (`onfinish`/`oncancel` → remove) : zéro fuite DOM même après vingt bursts.
 *
 * Coupé par `prefers-reduced-motion` : les particules passent par JS (la media
 * query CSS globale de globals.css ne les atteint pas), donc la garde est ici.
 */

// Les cinq composantes de la palette (specs §2), en tokens — jamais de hex en dur.
const PALETTE = ["--magenta", "--violet", "--cyan", "--green", "--amber"] as const;

// Pas de valeur magique (garde-fou repo) : tout le réglage du burst est nommé.
const PARTICLE_COUNT = 18;
const MIN_DURATION_MS = 700;
const DURATION_SPREAD_MS = 400; // → durée effective de 700 à 1100 ms
const PARTICLE_SIZE_PX = 8;
const MIN_DISTANCE_PX = 40;
const DISTANCE_SPREAD_PX = 70;
const FALL_PX = 30; // la gravité : la retombée ajoutée à la trajectoire
const MAX_ROTATION_DEG = 540;
const EASING = "cubic-bezier(.2,.7,.3,1)";
const Z_INDEX = 60; // au-dessus du toast (z-50), sous rien d'autre

/** Vrai si l'utilisateur demande le minimum de mouvement (ou hors navigateur). */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Déclenche le burst depuis un point de l'écran (coordonnées viewport, à capter
 * au tap car le bouton disparaît une fois la lecture terminée). Les particules
 * sont en `position: fixed` : indépendantes du scroll et d'un ancêtre positionné.
 * No-op sous `prefers-reduced-motion` ou côté serveur.
 */
export function burstConfetti(origin: { x: number; y: number }): void {
  if (prefersReducedMotion()) return;

  for (let index = 0; index < PARTICLE_COUNT; index++) {
    const particle = document.createElement("span");
    particle.setAttribute("aria-hidden", "true");
    particle.style.cssText =
      `position:fixed;left:${origin.x}px;top:${origin.y}px;` +
      `width:${PARTICLE_SIZE_PX}px;height:${PARTICLE_SIZE_PX}px;` +
      `border-radius:2px;pointer-events:none;z-index:${Z_INDEX};` +
      `background:var(${PALETTE[index % PALETTE.length]});`;
    document.body.appendChild(particle);

    const angle = Math.random() * Math.PI * 2;
    const distance = MIN_DISTANCE_PX + Math.random() * DISTANCE_SPREAD_PX;
    const endX = Math.cos(angle) * distance;
    const endY = Math.sin(angle) * distance + FALL_PX;
    const rotation = Math.random() * MAX_ROTATION_DEG;

    const animation = particle.animate(
      [
        { transform: "translate(0,0) rotate(0)", opacity: 1 },
        { transform: `translate(${endX}px,${endY}px) rotate(${rotation}deg)`, opacity: 0 },
      ],
      { duration: MIN_DURATION_MS + Math.random() * DURATION_SPREAD_MS, easing: EASING },
    );
    // Le nettoyage : fin normale OU annulation (onglet masqué) → on retire du DOM.
    const cleanup = () => particle.remove();
    animation.onfinish = cleanup;
    animation.oncancel = cleanup;
  }
}
