import type { NextConfig } from "next";

// L'hôte Supabase du projet — les photos de couverture maison (bucket public
// `covers`, specs §5.4) passent par next/image comme les couvertures externes.
const supabaseHostname = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

const nextConfig: NextConfig = {
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
    ];
  },
  images: {
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
      ...(supabaseHostname
        ? [{ protocol: "https" as const, hostname: supabaseHostname, pathname: "/storage/v1/object/public/**" }]
        : []),
    ],
  },
};

export default nextConfig;
