/**
 * La notation en étoiles (design-specs §4) : ambre, demi-étoiles.
 *
 * Deux couches d'étoiles pleines superposées — un fond terne (`--ink3`) et un
 * calque ambre découpé à la largeur `note/max`. La demi-étoile tombe donc
 * naturellement (46 % de largeur = 2,3 étoiles). Purement présentatiel.
 */

type StarsProps = {
  rating: number;
  max?: number;
  className?: string;
};

export function Stars({ rating, max = 5, className = "" }: StarsProps) {
  const ratio = Math.max(0, Math.min(1, rating / max));
  const glyphs = "★".repeat(max);
  const label = `Noté ${rating.toLocaleString("fr-FR")} sur ${max}`;

  return (
    <span
      role="img"
      aria-label={label}
      className={`relative inline-block align-middle text-[13px] leading-none tracking-[1px] ${className}`}
    >
      <span aria-hidden className="text-ink3">
        {glyphs}
      </span>
      <span
        aria-hidden
        className="absolute inset-0 overflow-hidden text-amber"
        style={{ width: `${ratio * 100}%` }}
      >
        {glyphs}
      </span>
    </span>
  );
}
