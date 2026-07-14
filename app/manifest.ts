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
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
