/**
 * Les chemins servis SANS session — la liste unique que le proxy d'auth
 * consulte (défense en profondeur : le `matcher` de proxy.ts exclut en plus
 * les assets pour la perf, mais c'est CETTE fonction qui fait foi).
 *
 * « Publiques par nécessité » : le navigateur (ou le service worker) récupère
 * ces ressources sans cookies — manifest et icônes à l'installation PWA, et
 * le binaire WASM du scanner, précaché par le SW dès la page de login.
 * Derrière le mur d'auth, la redirection vers /login empoisonnait le cache
 * SW avec du HTML servi comme binaire — scanner définitivement mort
 * (issue #60, reproduit le 19/07/2026). Ne retirer un chemin d'ici qu'en
 * sachant ce que son client fait d'une redirection.
 */
export function isPublicPath(path: string): boolean {
  return (
    path === "/sw.js" ||
    path === "/manifest.webmanifest" ||
    path.startsWith("/icons/") ||
    path.startsWith("/wasm/") ||
    path.startsWith("/login") ||
    path.startsWith("/auth")
  );
}
