/**
 * LE message d'erreur générique des Server Actions : les erreurs techniques
 * (Postgres, Supabase) partent en `console.error` côté serveur — jamais à
 * l'écran, où elles ne parlent pas français et révèlent le schéma.
 */
export const GENERIC_ERROR_MESSAGE = "Une erreur est survenue, réessaie.";