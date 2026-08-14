/**
 * La réparation des liens de couverture cassés (issue #53) — la contrepartie
 * assumée du hotlink (epagine en tête, specs §5.4) : une URL stockée peut
 * mourir après coup. La DÉCISION vit ici, pure et testée ; l'action serveur
 * ne fait qu'appliquer.
 */

/**
 * Les hôtes d'où viennent nos couvertures distantes — à garder en phase avec
 * les `remotePatterns` de `next.config.ts` (la même liste, deux couches :
 * l'optimiseur d'images côté affichage, la re-vérification côté réparation).
 */
const KNOWN_COVER_HOSTNAMES = [
  "static.metron.cloud",
  "books.google.com",
  "covers.openlibrary.org",
  "inventaire.io",
  "openapi.bnf.fr",
  "images.epagine.fr",
] as const;
const GOOGLE_USER_CONTENT_SUFFIX = ".googleusercontent.com";

/**
 * Garde SSRF (review #57) : le serveur ne re-vérifie JAMAIS une URL hors des
 * hôtes de couverture connus — `books.cover_url` peut être posé par un client
 * forgé, et un `fetch` serveur d'une cible arbitraire n'a rien à faire ici.
 */
export function isKnownCoverImageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return (
    (KNOWN_COVER_HOSTNAMES as readonly string[]).includes(parsed.hostname) ||
    parsed.hostname.endsWith(GOOGLE_USER_CONTENT_SUFFIX)
  );
}

export type CoverRepairDecision =
  /** Une autre couverture existe : on remplace. */
  | { action: "replace"; coverUrl: string }
  /** Rien de mieux, mais rien ne prouve que l'actuelle est morte : on ne détruit pas. */
  | { action: "keep" }
  /** La chaîne n'a rien ET l'URL actuelle est confirmée morte : retour à « sans couverture » — l'UI proposera la photo (#33). */
  | { action: "clear" };

/**
 * `currentUrlIsAlive` : le verdict d'une re-vérification SERVEUR de l'URL
 * actuelle — `null` quand elle n'a pas pu être établie (réseau, timeout).
 * Le doute profite TOUJOURS à l'existant : on ne vide jamais une couverture
 * sur un signal ambigu (un `onError` client peut être un simple problème de
 * réseau côté utilisateur).
 */
export function decideCoverRepair(
  currentCoverUrl: string,
  foundCoverUrl: string | null,
  currentUrlIsAlive: boolean | null,
): CoverRepairDecision {
  if (foundCoverUrl && foundCoverUrl !== currentCoverUrl) return { action: "replace", coverUrl: foundCoverUrl };
  // La chaîne rend la MÊME URL : le provider la considère vivante — l'échec
  // de chargement était côté client (réseau, blocage local). On garde.
  if (foundCoverUrl === currentCoverUrl) return { action: "keep" };
  if (currentUrlIsAlive === false) return { action: "clear" };
  return { action: "keep" };
}

/**
 * L'anti-boucle PERSISTANTE (#177) : une réparation tentée se tamponne en base
 * (`books.cover_repair_attempted_at`) AVANT de dérouler la chaîne — le Set
 * mémoire du client meurt au rechargement de page, ce tampon non. Passé le
 * TTL, on retente : les crans de repli s'étoffent avec le temps (§5.4).
 */
export const COVER_REPAIR_RETRY_DAYS = 7;

/** Vrai si une tentative assez récente interdit d'en repayer une. */
export function isRepairAttemptFresh(attemptedAt: string | null, nowMs: number = Date.now()): boolean {
  return attemptedAt !== null && nowMs - Date.parse(attemptedAt) < COVER_REPAIR_RETRY_DAYS * 86_400_000;
}
