/**
 * Service worker MINIMAL (specs §4.9) : la coquille applicative en cache,
 * rien de plus — pas de synchronisation hors ligne au lancement (TBD §11).
 *
 * Stratégie :
 *  - navigations : réseau d'abord, cache en secours (l'app reste ouvrable sans réseau) ;
 *  - icônes/manifest : cache d'abord (immuables entre déploiements) ;
 *  - /api/* : JAMAIS touché — les données sont toujours fraîches.
 */
const CACHE_NAME = "objectif-pal-shell-v1";
const SHELL_ASSETS = ["/", "/icons/icon-192.png", "/icons/icon-512.png"];

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

  // Icônes et manifest : cache d'abord.
  if (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
  }
});
