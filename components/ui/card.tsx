import type { ComponentProps } from "react";

/**
 * La carte de base (design-specs §4) : surface `--card`, bordure `--line`,
 * rayon 20px. Purement présentatiel — pas de "use client".
 */
export function Card({ className = "", ...props }: ComponentProps<"div">) {
  return <div className={`rounded-card border border-line bg-card p-4 ${className}`} {...props} />;
}
