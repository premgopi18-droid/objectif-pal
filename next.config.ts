import type { NextConfig } from "next";

// L'hôte Supabase du projet — les photos de couverture maison (bucket public
// `covers`, specs §5.4) passent par next/image comme les couvertures externes.
const supabaseHostname = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

const nextConfig: NextConfig = {
  compiler: {
    /**
     * Les drapeaux de tree-shaking du SDK Sentry (fluidité #331, item 8).
     * L'app ne remonte que des erreurs (`tracesSampleRate: 0`, pas de Replay,
     * cf. instrumentation-client.ts et sentry.*.config.ts), mais le SDK
     * navigateur partait ENTIER dans le chunk racine de toutes les routes —
     * tracing compris (~410 Ko non gzip pour react-dom + Sentry). Ce sont les
     * mêmes constantes que `withSentryConfig({ bundleSizeOptimizations })`
     * pose… en webpack seulement (`@sentry/nextjs/build/cjs/config/webpack.js`) :
     * sous Turbopack, c'est `compiler.define` qui les remplace à la compilation,
     * client ET serveur (aucune des trois configs ne trace). ⚠️ Le jour où le
     * serveur devra tracer (latence des server actions), retirer
     * `__SENTRY_TRACING__` d'ici — ou le poser côté client seulement.
     */
    define: {
      __SENTRY_DEBUG__: false,
      __SENTRY_TRACING__: false,
      __RRWEB_EXCLUDE_IFRAME__: true,
      __RRWEB_EXCLUDE_SHADOW_DOM__: true,
      __SENTRY_EXCLUDE_REPLAY_WORKER__: true,
    },
  },
  // Les en-têtes de sécurité de base : anti-clickjacking (l'app n'a aucune
  // raison d'être embarquée dans une iframe), anti-sniffing de type MIME, et
  // un referrer sobre. La CSP complète est un ticket séparé (risque de casser
  // la prod) : ici, seul `frame-ancestors`.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // Les statiques de public/ (fluidité #331, item 10) : 24 polices de
        // partage, fonds et vignettes de thème, logo de la splash et icônes
        // héritaient du défaut Vercel (`max-age=0, must-revalidate`) — un
        // aller-retour conditionnel par fichier à chaque session. 7 jours de
        // cache, 30 jours de stale-while-revalidate. PAS `immutable` : un fond
        // de thème peut être recalibré en place.
        // PAS `/wasm/` (review #341) : le SW re-fetche le binaire à chaque bump
        // de CACHE_NAME et ce fetch passe par le cache HTTP — un max-age long
        // lui servirait l'ANCIEN binaire face au JS neuf (le scénario #60). Il
        // n'y gagnerait rien de toute façon : le SW le sert cache-first.
        source: "/(share|brand|icons)/(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=2592000" }],
      },
    ];
  },
  images: {
    // Une couverture de livre est immuable en pratique (nos photos maison sont
    // versionnées par `?v=`), mais certains CDN (epagine, BnF) envoient des
    // Cache-Control courts → Vercel re-fetchait/re-transformait la même image.
    // 31 jours de plancher (#126, audit perf du 20/07/2026).
    minimumCacheTTL: 2678400,
    // Les couvertures distantes de la cascade (specs §5.4) : Metron pour la VO,
    // Google Books puis OpenLibrary, Inventaire, BnF Couvertures et epagine
    // pour l'ISBN (décisions du 19/07/2026). Les photos maison passeront par
    // Supabase Storage.
    remotePatterns: [
      { protocol: "https", hostname: "static.metron.cloud" },
      { protocol: "https", hostname: "books.google.com" },
      { protocol: "https", hostname: "*.googleusercontent.com" },
      { protocol: "https", hostname: "covers.openlibrary.org" },
      { protocol: "https", hostname: "inventaire.io" },
      { protocol: "https", hostname: "openapi.bnf.fr", pathname: "/couverture/**" },
      { protocol: "https", hostname: "images.epagine.fr", pathname: "/**/*.jpg" },
      // Comic Vine (#279) : lien direct, jamais rapatrié — leurs images restent chez eux.
      { protocol: "https", hostname: "comicvine.gamespot.com", pathname: "/a/uploads/**" },
      ...(supabaseHostname
        ? [{ protocol: "https" as const, hostname: supabaseHostname, pathname: "/storage/v1/object/public/**" }]
        : []),
    ],
  },
};

export default nextConfig;
