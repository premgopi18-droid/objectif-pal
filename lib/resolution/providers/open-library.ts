/**
 * Le provider OpenLibrary — couvertures par ISBN, gratuit et SANS clé, hotlink
 * accepté (specs §5.4, décision du 19/07/2026). Couverture réelle mesurée :
 * bonne sur les romans, correcte sur le manga VF, variable sur la BD.
 *
 * Depuis #277 (lot E), aussi la recherche des **autres éditions** d'une œuvre
 * par titre + auteur : OpenLibrary modélise l'œuvre (`/works/…`) et ses
 * éditions, chacune avec ses couvertures (`covers[]`, ids), son éditeur et sa
 * date. C'est la seule réponse gratuite au livre dont l'ISBN n'a d'image nulle
 * part — réédition, intégrale, collector — et au livre sans code-barres.
 */

import { OUTBOUND_USER_AGENT, PROVIDER_REQUEST_TIMEOUT_MILLISECONDS, ProviderUnavailableError } from "@/lib/resolution/types";

const OPEN_LIBRARY_COVER_ENDPOINT = "https://covers.openlibrary.org/b/isbn";
const OPEN_LIBRARY_COVER_BY_ID_ENDPOINT = "https://covers.openlibrary.org/b/id";
const OPEN_LIBRARY_API = "https://openlibrary.org";

/** Bornes de la recherche d'éditions : œuvres consultées, éditions lues par œuvre. */
export const EDITION_SEARCH_LIMITS = { works: 3, editionsPerWork: 20 } as const;

/** Une édition sœur, avec de quoi l'étiqueter honnêtement (« Autre édition · Gallimard 2015 »). */
export type EditionCover = {
  coverUrl: string;
  workTitle: string | null;
  publisher: string | null;
  year: string | null;
  isbn13: string | null;
};

type SearchDoc = { key?: string; title?: string; cover_i?: number; edition_count?: number };
type EditionEntry = {
  covers?: number[];
  publishers?: string[];
  publish_date?: string;
  isbn_13?: string[];
};

/** L'année dans une date OpenLibrary en forme libre (« Feb 04, 2021 », « 22/12/2007 », « 2015 »). */
const yearOf = (publishDate: string | undefined): string | null => publishDate?.match(/\b(1[5-9]\d{2}|20\d{2})\b/)?.[1] ?? null;

const coverUrlForId = (coverId: number) => `${OPEN_LIBRARY_COVER_BY_ID_ENDPOINT}/${coverId}-L.jpg`;

export type OpenLibraryProvider = ReturnType<typeof createOpenLibraryProvider>;

export function createOpenLibraryProvider(fetchImplementation: typeof fetch = fetch) {
  async function getJson<T>(url: string): Promise<T> {
    const response = await fetchImplementation(url, {
      headers: { "User-Agent": OUTBOUND_USER_AGENT },
      signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MILLISECONDS),
    });
    // Panne ≠ absence (#175) : throttle/5xx = source indisponible, pas un verdict.
    if (response.status === 429 || response.status >= 500) {
      throw new ProviderUnavailableError("OpenLibrary", `HTTP ${response.status}`);
    }
    if (!response.ok) throw new Error(`OpenLibrary : HTTP ${response.status}`);
    return (await response.json()) as T;
  }

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

    /**
     * Les couvertures des éditions sœurs d'une œuvre (#277) : une recherche
     * par titre (+ auteur), puis les éditions des premières œuvres trouvées,
     * lues en parallèle. Seules les éditions AVEC image remontent, dédoublonnées
     * par image, ordonnées : œuvre la mieux classée d'abord, puis année
     * décroissante. La couverture de l'œuvre elle-même ferme la liste si
     * aucune édition ne la portait.
     */
    async searchEditionCovers(
      query: { title: string; author: string | null },
      limits: { works?: number; editionsPerWork?: number } = {},
    ): Promise<EditionCover[]> {
      const worksLimit = limits.works ?? EDITION_SEARCH_LIMITS.works;
      const editionsLimit = limits.editionsPerWork ?? EDITION_SEARCH_LIMITS.editionsPerWork;
      const params = new URLSearchParams({
        title: query.title,
        fields: "key,title,cover_i,edition_count",
        limit: String(worksLimit),
      });
      if (query.author) params.set("author", query.author);
      const search = await getJson<{ docs?: SearchDoc[] }>(`${OPEN_LIBRARY_API}/search.json?${params.toString()}`);
      // Borné localement aussi : la limite est envoyée à l'API, mais c'est ici
      // que le nombre d'appels d'éditions se décide.
      const works = (search.docs ?? []).filter((doc): doc is SearchDoc & { key: string } => typeof doc.key === "string").slice(0, worksLimit);
      if (works.length === 0) return [];

      const perWork = await Promise.all(
        works.map(async (work) => {
          const editions = await getJson<{ entries?: EditionEntry[] }>(`${OPEN_LIBRARY_API}${work.key}/editions.json?limit=${editionsLimit}`);
          const covers: (EditionCover & { coverId: number })[] = [];
          for (const edition of editions.entries ?? []) {
            const coverId = (edition.covers ?? []).find((id) => id > 0);
            if (coverId === undefined) continue;
            covers.push({
              coverId,
              coverUrl: coverUrlForId(coverId),
              workTitle: work.title ?? null,
              publisher: edition.publishers?.[0]?.trim() || null,
              year: yearOf(edition.publish_date),
              isbn13: edition.isbn_13?.[0] ?? null,
            });
          }
          // Année décroissante, les sans-date en dernier — stable sinon.
          covers.sort((a, b) => (b.year ?? "0").localeCompare(a.year ?? "0"));
          if (work.cover_i && work.cover_i > 0 && !covers.some((cover) => cover.coverId === work.cover_i)) {
            covers.push({ coverId: work.cover_i, coverUrl: coverUrlForId(work.cover_i), workTitle: work.title ?? null, publisher: null, year: null, isbn13: null });
          }
          return covers;
        }),
      );

      const seen = new Set<number>();
      const result: EditionCover[] = [];
      for (const cover of perWork.flat()) {
        if (seen.has(cover.coverId)) continue;
        seen.add(cover.coverId);
        const { coverId: _coverId, ...edition } = cover;
        void _coverId;
        result.push(edition);
      }
      return result;
    },
  };
}
