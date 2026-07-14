import type { NextConfig } from "next";

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
    // Google Books pour la VF. Les photos maison passeront par Supabase Storage.
    remotePatterns: [
      { protocol: "https", hostname: "static.metron.cloud" },
      { protocol: "https", hostname: "books.google.com" },
      { protocol: "https", hostname: "*.googleusercontent.com" },
    ],
  },
};

export default nextConfig;
