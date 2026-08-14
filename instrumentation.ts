import { captureRequestError } from "@sentry/nextjs";

/**
 * Observabilité serveur (issue #181, epic #182) — Sentry, plan gratuit.
 *
 * À 1 utilisateur, l'utilisateur est l'opérateur : il voit les pannes. À
 * 30-100, une erreur serveur invisible devient une rumeur (« l'app marche
 * pas ») — le précédent #60 (scanner mort en prod, découvert à l'usage) a
 * montré le coût de l'angle mort.
 *
 * ERREURS SEULEMENT : tracing et replay coupés — le quota gratuit sert à
 * savoir qu'un utilisateur est en erreur, pas à faire de la télémétrie.
 * Sans DSN configuré (dev local, CI), tout est inerte.
 */

export async function register() {
  // Un init PAR runtime, chargé dynamiquement (review #188) : l'init nodejs
  // embarque des intégrations qui n'ont rien à faire dans le bundle edge (le
  // proxy) — le pattern officiel @sentry/nextjs. Jamais de PII nulle part
  // (pas d'IP, pas de cookies — RGPD, specs §7).
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
}

/** Les erreurs des Server Components / actions / routes remontent ici. */
export const onRequestError = captureRequestError;
