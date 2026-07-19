import type { ComponentProps } from "react";

/**
 * Le bouton de base (design-specs §4). Quatre variantes :
 * - `grad` : le CTA — dégradé signature + ombre violette. Texte/icône en `--bg0`
 *   (encre sombre), PAS blanc : le blanc échoue AA sur le cran vert du dégradé
 *   (≈ 1,6:1), l'encre sombre passe partout (4,6–10:1) — décision d'audit #66.
 * - `ghost` : surface relevée `--card2`, pour les actions secondaires.
 * - `done` : vert sémantique, le geste « Terminé ✓ ».
 * - `danger` : allure ghost mais encre `--red` — LA variante des actions
 *   destructives (déconnexion, retrait), définie ici et nulle part ailleurs (#84).
 *   L'encre vit DANS la variante (pas de `text-red` surchargé depuis l'appelant :
 *   l'ordre du CSS compilé Tailwind ne garantirait pas l'emport sur `text-ink`).
 *   Contraste mesuré : `--red` #FF5470 sur `--card2` #2B1A55 = 4,89:1 ✓ AA.
 *
 * `block` occupe toute la largeur (CTA pleine largeur, cible tactile ≥ 44px).
 * Purement présentatiel : pas de "use client" — utilisable côté serveur comme client.
 */

type ButtonVariant = "grad" | "ghost" | "done" | "danger";

type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  block?: boolean;
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl font-bold transition active:scale-[0.97] " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan " +
  "disabled:pointer-events-none disabled:opacity-50";

const VARIANTS: Record<ButtonVariant, string> = {
  grad: "bg-grad text-bg0 shadow-grad",
  ghost: "bg-card2 text-ink border border-line",
  done: "bg-green/15 text-green border border-green/30",
  danger: "bg-card2 text-red border border-line",
};

export function Button({ variant = "grad", block = false, className = "", ...props }: ButtonProps) {
  const sizing = block
    ? "flex w-full min-h-11 px-4 py-3.5 text-[15px]"
    : "px-3.5 py-2.5 text-sm";
  return <button className={`${BASE} ${VARIANTS[variant]} ${sizing} ${className}`} {...props} />;
}
