/**
 * Le provider Inventaire.io — couvertures par ISBN (specs §5.4, décision du
 * 19/07/2026). Projet ouvert (données CC0), images communautaires hébergées
 * chez eux, API sans clé. Point fort mesuré : le fonds FRANCOPHONE (BD, manga
 * VF) — c'est une communauté française. Association à petite infra : le
 * timeout partagé et la dégradation douce de la cascade s'appliquent comme
 * partout.
 */

import { OUTBOUND_USER_AGENT, PROVIDER_REQUEST_TIMEOUT_MILLISECONDS } from "@/lib/resolution/types";

const INVENTAIRE_ORIGIN = "https://inventaire.io";

/**
 * Largeur demandée à leur redimensionneur — alignée sur le rapatriement
 * (MAX_DIMENSION de scripts/covers-internalize.mjs) : l'affichage plafonne à
 * 96×144 CSS (192-288 px retina), on ne stocke jamais plus grand que 400.
 */
const INVENTAIRE_RESIZED_SIZE = 400;

/** Le chemin nu d'une image d'entité (`/img/entities/<hash>`), tel que rendu par leur API. */
const BARE_ENTITY_IMAGE_PATH = /^\/img\/entities\/([0-9a-f]+)$/;

/**
 * La variante redimensionnée d'une URL d'entité nue, ou null si l'URL n'a pas
 * cette forme. Mesuré le 12/09/2026 : leur cache de fichiers pleine taille
 * sert des 200 image/webp de 0 octet (empoisonnés depuis le 20/08, immutables
 * un an), alors que le redimensionneur régénère depuis la source — la variante
 * est donc le chemin FIABLE, l'URL nue le repli.
 * ⚠️ En phase avec la même règle dans scripts/covers-internalize.mjs.
 */
export function resizedInventaireVariant(absoluteUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(absoluteUrl);
  } catch {
    return null;
  }
  if (parsed.origin !== INVENTAIRE_ORIGIN) return null;
  const match = parsed.pathname.match(BARE_ENTITY_IMAGE_PATH);
  if (!match) return null;
  return `${INVENTAIRE_ORIGIN}/img/entities/${INVENTAIRE_RESIZED_SIZE}x${INVENTAIRE_RESIZED_SIZE}/${match[1]}`;
}

export type InventaireProvider = ReturnType<typeof createInventaireProvider>;

export function createInventaireProvider(fetchImplementation: typeof fetch = fetch) {
  return {
    /** L'URL de couverture pour un ISBN, ou null. */
    async findCoverByIsbn(isbn: string): Promise<string | null> {
      const response = await fetchImplementation(
        `${INVENTAIRE_ORIGIN}/api/entities/by-uris?uris=isbn:${isbn}`,
        { headers: { "User-Agent": OUTBOUND_USER_AGENT }, signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MILLISECONDS) },
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
      // La variante redimensionnée passe en premier (12/09/2026) : elle
      // régénère depuis la source, là où le fichier pleine taille peut être
      // un vide caché immutable.
      const resizedUrl = resizedInventaireVariant(absoluteUrl);
      for (const candidateUrl of resizedUrl ? [resizedUrl, absoluteUrl] : [absoluteUrl]) {
        try {
          const image = await fetchImplementation(candidateUrl, {
            method: "HEAD",
            headers: { "User-Agent": OUTBOUND_USER_AGENT },
            signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MILLISECONDS),
          });
          if (image.ok && image.headers.get("content-length") !== "0") return candidateUrl;
        } catch {
          // Candidat injoignable : le suivant joue.
        }
      }
      return null;
    },
  };
}
