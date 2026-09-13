import * as Sentry from "@sentry/nextjs";
import { stripBreadcrumbQuery } from "./sentry.breadcrumbs";

/**
 * L'init Sentry du runtime EDGE (issue #181) — le proxy (middleware) vit ici :
 * l'init doit rester légère et sans module Node. Chargée dynamiquement par
 * `instrumentation.ts`. Erreurs seulement, pas de PII ; inerte sans DSN.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0,
  sendDefaultPii: false,
  // Jamais une clé d'API (query des fetch sortants) dans un événement (audit #274).
  beforeBreadcrumb: stripBreadcrumbQuery,
});
