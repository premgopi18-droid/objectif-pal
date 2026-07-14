/**
 * LE message d'erreur générique des Server Actions : les erreurs techniques
 * (Postgres, Supabase) partent en `console.error` côté serveur — jamais à
 * l'écran, où elles ne parlent pas français et révèlent le schéma.
 */
export const GENERIC_ERROR_MESSAGE = "Une erreur est survenue, réessaie.";

/**
 * Le message des gestes qui n'ont pas ATTEINT le serveur : une Server Action
 * dont la promesse rejette (réseau coupé, avion…) ne renvoie pas de
 * `{ ok: false }` — sans try/catch côté client, l'échec serait muet.
 */
export const NETWORK_ERROR_MESSAGE = "Impossible de joindre le serveur — vérifie ta connexion et réessaie.";