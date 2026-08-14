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
const CACHE_NAME = "objectif-pal-shell-v5"; // v5 : précache gardé contre les redirections (#195) — purge les coquilles /login empoisonnées
// ⚠️ "/" est du HTML AUTHENTIFIÉ : la déconnexion purge tous les caches
// (components/logout-button.tsx). Icônes et WASM se re-remplissent au fil des
// fetchs ; la coquille "/", elle, se rafraîchit à chaque navigation réussie
// vers "/" en session (#195) — la vie privée d'un appareil partagé reste
// couverte par la purge de déconnexion, compromis documenté et assumé.
const SHELL_ASSETS = ["/", "/icons/icon-192.png", "/icons/icon-512.png", "/wasm/zxing_reader.wasm"];

self.addEventListener("install", (event) => {
  // Jamais addAll (#195) : il suit les redirections — un SW installé depuis
  // /login (le cas NOMINAL : hors session) précachait le HTML de /login sous
  // la clé "/". Même garde que le fetch handler : une réponse redirigée ou en
  // erreur est SAUTÉE, jamais mise en cache — la coquille "/" arrivera par la
  // première navigation en session (ci-dessous).
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        SHELL_ASSETS.map((asset) =>
          fetch(asset)
            .then((response) => {
              if (response.ok && !response.redirected) return cache.put(asset, response);
            })
            .catch(() => {}),
        ),
      ),
    ),
  );
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
  // Exception UNIQUE (#195) : une navigation réussie vers "/" EN SESSION (200,
  // non redirigée) rafraîchit la coquille — c'est ce qui donne sa coquille au
  // SW installé hors session, et la garde fraîche entre deux déploiements.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (url.pathname === "/" && response.ok && !response.redirected) {
            const copy = response.clone();
            // waitUntil (review #196) : garantit la fenêtre d'écriture — sans
            // lui, le SW peut être tué après la réponse, avant la fin du put.
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put("/", copy)));
          }
          return response;
        })
        .catch(() => caches.match("/")),
    );
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
