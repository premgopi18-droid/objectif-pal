import type { ReactNode } from "react";

/**
 * Le titre d'écran du flux scan (design-specs §2) : 900 italique, majuscules,
 * léger interlettrage négatif — l'énergie « QUI VA GAGNER ? ». Un mot-clé peut
 * porter le dégradé signature via <GradientWord> (background-clip: text).
 * Purement présentatiel — utilisable côté client comme serveur.
 */

type ScreenTitleProps = {
  children: ReactNode;
  /** Le sous-titre discret sous le titre (facultatif). */
  subtitle?: ReactNode;
};

export function ScreenTitle({ children, subtitle }: ScreenTitleProps) {
  return (
    <div>
      <h1 className="text-2xl font-black uppercase italic tracking-tight text-ink">{children}</h1>
      {subtitle && <p className="mt-1 mb-4 text-sm text-ink2">{subtitle}</p>}
    </div>
  );
}

/** Un mot-clé du titre peint au dégradé signature (background-clip: text, §2). */
export function GradientWord({ children }: { children: ReactNode }) {
  return <span className="bg-grad bg-clip-text text-transparent">{children}</span>;
}
