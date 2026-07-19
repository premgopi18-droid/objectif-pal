/**
 * Les confettis de la scène du login (design-specs §2 « Matière ») : décor pur,
 * `aria-hidden`, sans animation — l'affiche de l'émission, pas une distraction.
 *
 * Les positions sont tirées par un PRNG DÉTERMINISTE (graine fixe) calculé une
 * fois au chargement du module : le rendu serveur et le rendu client produisent
 * exactement la même chose → pas de décalage d'hydratation (contrairement à un
 * Math.random() qui divergerait). Les couleurs passent par les tokens de la
 * palette (var(--…)), jamais de hex en dur (garde-fou §6).
 */

// Les cinq composantes de la palette (specs §2), en tokens.
const PALETTE = ["--magenta", "--violet", "--cyan", "--green", "--amber"] as const;

// Générateur congruentiel linéaire : reproductible, sans dépendance.
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

const random = seededRandom(20260719);

const CONFETTI = Array.from({ length: 42 }, (_, index) => {
  const size = 3 + random() * 6;
  return {
    left: random() * 100,
    top: random() * 100,
    size,
    rotate: random() * 360,
    opacity: 0.15 + random() * 0.4,
    color: PALETTE[index % PALETTE.length],
  };
});

export function SceneConfetti() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {CONFETTI.map((confetto, index) => (
        <span
          key={index}
          className="absolute rounded-[2px]"
          style={{
            left: `${confetto.left}%`,
            top: `${confetto.top}%`,
            width: `${confetto.size}px`,
            height: `${confetto.size}px`,
            transform: `rotate(${confetto.rotate}deg)`,
            opacity: confetto.opacity,
            background: `var(${confetto.color})`,
          }}
        />
      ))}
    </div>
  );
}
