import * as Sentry from "@sentry/nextjs";

/**
 * L'init Sentry du runtime NODEJS (issue #181) — chargé dynamiquement par
 * `instrumentation.ts`, jamais dans le bundle edge. Erreurs seulement, pas de
 * PII ; inerte sans DSN.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0,
  sendDefaultPii: false,
});
