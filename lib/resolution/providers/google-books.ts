/**
 * Le provider Google Books — les couvertures (la BnF n'en fournit pas) et les
 * romans étrangers. ⚠️ La clé est OBLIGATOIRE : 429 systématique sans clé,
 * même depuis une IP résidentielle (mesuré, specs §5.2). Sans clé configurée,
 * le provider se déclare simplement muet et la cascade continue.
 */

import { PROVIDER_REQUEST_TIMEOUT_MILLISECONDS } from "@/lib/resolution/types";

const GOOGLE_BOOKS_ENDPOINT = "https://www.googleapis.com/books/v1/volumes";

export type GoogleBooksRecord = {
  title: string | null;
  authors: string | null;
  publisher: string | null;
  pageCount: number | null;
  coverUrl: string | null;
  categories: string[] | null;
  volumeId: string;
};

type VolumeInfo = {
  title?: string;
  authors?: string[];
  publisher?: string;
  pageCount?: number;
  categories?: string[];
  imageLinks?: { thumbnail?: string; smallThumbnail?: string };
};

export type GoogleBooksProvider = ReturnType<typeof createGoogleBooksProvider>;

export function createGoogleBooksProvider(
  apiKey: string | undefined = process.env.GOOGLE_BOOKS_API_KEY,
  fetchImplementation: typeof fetch = fetch,
) {
  return {
    /** Fiche par ISBN. `null` = introuvable OU pas de clé configurée. */
    async resolveIsbn(isbn: string): Promise<GoogleBooksRecord | null> {
      if (!apiKey) return null;

      const url = `${GOOGLE_BOOKS_ENDPOINT}?q=isbn:${isbn}&key=${apiKey}`;
      const response = await fetchImplementation(url, {
        signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MILLISECONDS),
      });
      if (!response.ok) throw new Error(`Google Books : HTTP ${response.status}`);

      const payload = (await response.json()) as {
        totalItems?: number;
        items?: { id: string; volumeInfo?: VolumeInfo }[];
      };
      const item = payload.items?.[0];
      if (!payload.totalItems || !item) return null;

      const info = item.volumeInfo ?? {};
      // Mesuré (specs §5.4) : la couverture manque souvent sur la VF — nullable assumé.
      const thumbnail = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail ?? null;
      return {
        title: info.title ?? null,
        authors: info.authors?.join(", ") ?? null,
        publisher: info.publisher ?? null,
        pageCount: info.pageCount ?? null,
        coverUrl: thumbnail ? thumbnail.replace(/^http:/, "https:") : null,
        categories: info.categories ?? null,
        volumeId: item.id,
      };
    },
  };
}
