/**
 * Le provider epagine — couvertures par ISBN (specs §5.4, décision du
 * 19/07/2026). Le CDN d'images des libraires français (Place des Libraires,
 * leslibraires.fr) : LA source qui couvre le mieux l'édition VF récente
 * (mesuré : seule à avoir la couverture d'un Urban Comics 2022 absent
 * partout ailleurs). Pas d'API publique documentée — hotlink assumé en
 * DERNIER repli avant la photo (#33), avec la réparation des liens cassés
 * comme filet (specs §5.4).
 *
 * Comportements MESURÉS le 19/07/2026 :
 *  - motif d'URL : /{3 derniers chiffres de l'ISBN}/{isbn}_1_75.jpg
 *  - HEAD accepté (nginx statique) — l'existence se vérifie sans télécharger.
 *  - ISBN inconnu → HTTP 200 quand même, mais un PNG placeholder (2 687
 *    octets) : c'est le content-type qui distingue — les vraies couvertures
 *    sont des JPEG.
 */

import { OUTBOUND_USER_AGENT, PROVIDER_REQUEST_TIMEOUT_MILLISECONDS } from "@/lib/resolution/types";

const EPAGINE_IMAGES_ORIGIN = "https://images.epagine.fr";
const ISBN_FOLDER_DIGIT_COUNT = 3;

export type EpagineProvider = ReturnType<typeof createEpagineProvider>;

export function createEpagineProvider(fetchImplementation: typeof fetch = fetch) {
  return {
    /** L'URL de couverture pour un ISBN (EAN-13), ou null. */
    async findCoverByIsbn(isbn: string): Promise<string | null> {
      const folder = isbn.slice(-ISBN_FOLDER_DIGIT_COUNT);
      const url = `${EPAGINE_IMAGES_ORIGIN}/${folder}/${isbn}_1_75.jpg`;
      const response = await fetchImplementation(url, {
        method: "HEAD",
        headers: { "User-Agent": OUTBOUND_USER_AGENT },
        signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MILLISECONDS),
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`epagine : HTTP ${response.status}`);
      // 200 ne veut pas dire trouvé : l'absence est un placeholder PNG. C'est
      // LE discriminant — on rejette le PNG plutôt qu'exiger le JPEG exact,
      // pour survivre à un `; charset=…` ou un passage au WebP (review #54).
      const contentType = response.headers.get("content-type") ?? "";
      return contentType.startsWith("image/") && !contentType.startsWith("image/png") ? url : null;
    },
  };
}
