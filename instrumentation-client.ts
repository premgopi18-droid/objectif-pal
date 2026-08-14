import * as Sentry from "@sentry/nextjs";

/**
 * Observabilité client (issue #181) — le pendant navigateur de
 * `instrumentation.ts` : les erreurs qui ne quittaient jamais l'appareil de
 * l'utilisateur (échecs d'upload, caméra, hydratation) deviennent visibles.
 * Erreurs seulement, pas de replay ni de tracing ; inerte sans DSN.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0,
  sendDefaultPii: false,
});
