import type { ReactNode } from "react";

/**
 * La pastille d'état (design-specs §4). Cinq états, mêmes priorités qu'en §4.12
 * des specs produit (le consommateur choisit lequel afficher) :
 * - `reading` (cyan) · `done` (vert) · `pile` (magenta) · `abandoned` (muet) · `idle` (ambre)
 * - `penalty` (rouge, #139) : le malus — la couleur sémantique du −1, déjà
 *   celle du « −1 » de la feuille d'achat. Un badge d'achat sans son rouge
 *   cacherait le coût.
 *
 * Chaque état = sa couleur sémantique posée sur son propre voile (opacité). Le
 * magenta « pile » est éclairci vers le blanc (color-mix) pour rester lisible
 * AA sur son voile — le magenta pur y descend sous 4:1. Purement présentatiel.
 */

type BadgeState = "reading" | "done" | "pile" | "abandoned" | "idle" | "penalty";

const STATES: Record<BadgeState, string> = {
  reading: "bg-cyan/15 text-cyan",
  done: "bg-green/15 text-green",
  pile: "bg-magenta/15 text-[color:color-mix(in_srgb,var(--magenta)_62%,white)]",
  abandoned: "bg-line text-ink2",
  idle: "bg-amber/15 text-amber",
  penalty: "bg-red/15 text-red",
};

export function Badge({ state, children }: { state: BadgeState; children: ReactNode }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${STATES[state]}`}
    >
      {children}
    </span>
  );
}
