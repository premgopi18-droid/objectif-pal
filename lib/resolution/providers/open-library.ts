/**
 * Le provider OpenLibrary — couvertures par ISBN, gratuit et SANS clé, hotlink
 * accepté (specs §5.4, décision du 19/07/2026). Couverture réelle mesurée :
 * bonne sur les romans, correcte sur le manga VF, variable sur la BD.
 */

import { OUTBOUND_USER_AGENT, PROVIDER_REQUEST_TIMEOUT_MILLISECONDS } from "@/lib/resolution/types";

const OPEN_LIBRARY_COVER_ENDPOINT = "https://covers.openlibrary.org/b/isbn";

export type OpenLibraryProvider = ReturnType<typeof createOpenLibraryProvider>;

export function createOpenLibraryProvider(fetchImplementation: typeof fetch = fetch) {
  return {
    /**
     * L'URL de couverture pour un ISBN, ou null. `?default=false` transforme
     * l'absence en 404 franc (sinon OpenLibrary rend un GIF 1×1 « blank » —
     * qu'on stockerait comme une vraie couverture).
     */
    async findCoverByIsbn(isbn: string): Promise<string | null> {
      const url = `${OPEN_LIBRARY_COVER_ENDPOINT}/${isbn}-L.jpg`;
      const response = await fetchImplementation(`${url}?default=false`, {
        method: "HEAD",
        headers: { "User-Agent": OUTBOUND_USER_AGENT },
        signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MILLISECONDS),
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`OpenLibrary : HTTP ${response.status}`);
      // L'URL stockée est SANS `default=false` : vérifiée existante ici, et si
      // l'image disparaissait un jour, un blank vaut mieux qu'un 404 dans <img>.
      return url;
    },
  };
}
