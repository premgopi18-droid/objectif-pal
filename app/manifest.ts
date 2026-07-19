import type { MetadataRoute } from "next";

/**
 * Le manifest PWA (specs §4.9) : sans lui, pas d'icône sur l'écran d'accueil
 * et un accès caméra bancal. Servi PUBLIC (cf. proxy.ts) : le navigateur le
 * récupère sans cookies.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Objectif PAL",
    short_name: "PAL",
    description: "Scanne tes lectures, fais fondre ta pile à lire.",
    lang: "fr",
    start_url: "/",
    display: "standalone",
    // La splash d'installation (Android) reprend le fond de l'affiche ; la barre
    // système garde la nuit de l'app. Voir components/splash-screen.tsx (§ refonte #64).
    background_color: "#2e2357",
    theme_color: "#120826",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
