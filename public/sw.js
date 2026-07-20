/**
 * Service worker MINIMAL (specs §4.9) : la coquille applicative en cache,
 * rien de plus — pas de synchronisation hors ligne au lancement (TBD §11).
 *
 * Stratégie :
 *  - navigations : réseau d'abord, cache en secours (l'app reste ouvrable sans réseau) ;
 *  - icônes/manifest : cache d'abord (immuables entre déploiements) ;
 *  - /api/* : JAMAIS touché — les données sont toujours fraîches.
 */
// ⚠️ À chaque bump du paquet zxing-wasm (donc du binaire copié dans
// /wasm/), incrémenter CACHE_NAME : sinon les clients gardent l'ancien
// binaire en cache, désynchronisé du JS — erreurs imprévisibles au scan.
// v3 (issue #60) : purge les caches où la redirection d'auth avait remplacé
// le binaire WASM par le HTML de /login (SW installé hors session).
const CACHE_NAME = "objectif-pal-shell-v4"; // v4 : icônes recompressées (#124) — sans bump, les anciennes resteraient précachées
// ⚠️ "/" est du HTML AUTHENTIFIÉ : la déconnexion purge tous les caches
// (components/logout-button.tsx). Icônes et WASM se re-remplissent au fil des
// fetchs ; la coquille "/", elle, n'est re-précachée qu'à la prochaine
// installation du SW (prochain déploiement) — hors ligne dégradé d'ici là,
// assumé : la vie privée d'un appareil partagé passe d'abord.
const SHELL_ASSETS = ["/", "/icons/icon-192.png", "/icons/icon-512.png", "/wasm/zxing_reader.wasm"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return;

  // Navigations : réseau d'abord, la COQUILLE en secours — on ne met jamais en
  // cache les pages naviguées elles-mêmes : elles contiennent du HTML
  // authentifié (le profil, demain le journal), et l'app est multi-utilisateur
  // par conception. Hors ligne, toute navigation retombe sur "/".
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/")));
    return;
  }

  // Icônes, manifest et binaire WASM du scanner : cache d'abord (immuables
  // entre déploiements — le WASM ne change qu'avec un bump de zxing-wasm,
  // couvert par l'incrément de CACHE_NAME ci-dessus).
  if (url.pathname.startsWith("/icons/") || url.pathname.startsWith("/wasm/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            // On ne met en cache que la VRAIE ressource : une réponse
            // redirigée ou en erreur (mur d'auth, panne) se ferait passer
            // pour l'asset à chaque visite suivante — le vecteur exact de
            // l'issue #60 (le HTML de /login servi comme binaire WASM).
            if (response.ok && !response.redirected) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
