import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
