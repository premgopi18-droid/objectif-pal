/**
 * La réparation des liens de couverture cassés (issue #53) — la contrepartie
 * assumée du hotlink (epagine en tête, specs §5.4) : une URL stockée peut
 * mourir après coup. La DÉCISION vit ici, pure et testée ; l'action serveur
 * ne fait qu'appliquer.
 */

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
