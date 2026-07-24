/**
 * Le provider Inventaire.io — couvertures par ISBN (specs §5.4, décision du
 * 19/07/2026). Projet ouvert (données CC0), images communautaires hébergées
 * chez eux, API sans clé. Point fort mesuré : le fonds FRANCOPHONE (BD, manga
 * VF) — c'est une communauté française. Association à petite infra : le
 * timeout partagé et la dégradation douce de la cascade s'appliquent comme
 * partout.
 */

import { PROVIDER_REQUEST_TIMEOUT_MILLISECONDS } from "@/lib/resolution/types";

const INVENTAIRE_ORIGIN = "https://inventaire.io";

export type InventaireProvider = ReturnType<typeof createInventaireProvider>;

export function createInventaireProvider(fetchImplementation: typeof fetch = fetch) {
  return {
    /** L'URL de couverture pour un ISBN, ou null. */
    async findCoverByIsbn(isbn: string): Promise<string | null> {
      const response = await fetchImplementation(
        `${INVENTAIRE_ORIGIN}/api/entities/by-uris?uris=isbn:${isbn}`,
        { signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MILLISECONDS) },
      );
      // 400 = ISBN que l'API juge invalide (clé de contrôle) : « introuvable »,
      // pas une panne — la cascade continue sans bruit.
      if (response.status === 400 || response.status === 404) return null;
      if (!response.ok) throw new Error(`Inventaire : HTTP ${response.status}`);

      const payload = (await response.json()) as {
        entities?: Record<string, { image?: { url?: string } }>;
      };
      const imageUrl = Object.values(payload.entities ?? {})[0]?.image?.url;
      if (!imageUrl) return null;
      // L'API rend un chemin relatif (`/img/entities/<hash>`) — mesuré le 19/07/2026.
      const absoluteUrl = imageUrl.startsWith("http") ? imageUrl : `${INVENTAIRE_ORIGIN}${imageUrl}`;

      // Vérifier L'IMAGE, pas la métadonnée (#158, vu en prod) : Inventaire
      // liste parfois une image qui répond 200 image/webp… de 0 octet. Sans ce
      // HEAD, la cascade — réparation #157 comprise — re-choisissait la même
      // URL fantôme pour toujours. Vide ou morte → null, le cran suivant joue.
      try {
        const image = await fetchImplementation(absoluteUrl, {
          method: "HEAD",
          signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MILLISECONDS),
        });
        if (!image.ok || image.headers.get("content-length") === "0") return null;
      } catch {
        return null;
      }
      return absoluteUrl;
    },
  };
}
