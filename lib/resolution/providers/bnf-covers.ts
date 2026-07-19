/**
 * Le provider Service Couvertures de la BnF — couvertures par ISBN (specs
 * §5.4, décision du 19/07/2026). API officielle lancée le 17/02/2026 (bêta),
 * gratuite, sans clé : le pendant « image » de notre source d'identification
 * VF. Réutilisation aux conditions BnF : source créditée (page profil).
 *
 * Comportements MESURÉS le 19/07/2026 :
 *  - HEAD → 405 : l'existence se vérifie en GET (on annule le corps sans le
 *    lire — seuls les en-têtes nous intéressent).
 *  - image absente → HTTP 500 (pas 404) : indistinguable d'une vraie panne,
 *    donc tout statut non-200 vaut « introuvable » — la cascade descend d'un
 *    cran sans bruit.
 */

import { PROVIDER_REQUEST_TIMEOUT_MILLISECONDS } from "@/lib/resolution/types";

const BNF_COVERS_ENDPOINT = "https://openapi.bnf.fr/couverture/image/image/recupererImage";

export type BnfCoversProvider = ReturnType<typeof createBnfCoversProvider>;

export function createBnfCoversProvider(fetchImplementation: typeof fetch = fetch) {
  return {
    /** L'URL de couverture pour un ISBN (EAN-13 sans tirets — accepté, mesuré), ou null. */
    async findCoverByIsbn(isbn: string): Promise<string | null> {
      const url = `${BNF_COVERS_ENDPOINT}?ISBN=${isbn}&couverture=1&taille=originale`;
      const response = await fetchImplementation(url, {
        signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MILLISECONDS),
      });
      // Le corps ne sert à rien (on ne stocke que l'URL) : on le relâche pour
      // libérer la connexion sans télécharger l'image.
      await response.body?.cancel();
      if (!response.ok) return null;
      // Garde-fou bêta : une page d'erreur en 200 ne doit pas passer pour une image.
      const contentType = response.headers.get("content-type") ?? "";
      return contentType.startsWith("image/") ? url : null;
    },
  };
}
