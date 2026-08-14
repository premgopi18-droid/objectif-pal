import * as Sentry from "@sentry/nextjs";

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
  Sentry.init({
    dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0,
    // Jamais de PII par défaut : pas d'IP, pas de cookies (RGPD, specs §7).
    sendDefaultPii: false,
  });
}

/** Les erreurs des Server Components / actions / routes remontent ici. */
export const onRequestError = Sentry.captureRequestError;
