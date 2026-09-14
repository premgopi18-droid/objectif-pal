/**
 * Le provider AniList (#304) — la source de fait pour le MANGA : l'œuvre
 * japonaise, dont une édition française normale partage le découpage et le
 * statut (mesuré le 14/09/2026 : 15 séries sur 20 reconnues, 0 erreur).
 * API GraphQL publique, sans clé, 90 requêtes/min. Jamais appelé au scan ni à
 * la fiche : le job de nuit seulement.
 *
 * Le rapprochement est STRICT (`matchAniListStrict`, pur) : titre normalisé
 * égal à l'un des titres ou synonymes, format MANGA, origine JP/KR/CN — jamais
 * le premier résultat. Les éditions spéciales (« Édition Colossale »,
 * « Deluxe ») ne matchent pas, et c'est voulu : leur découpage diffère.
 */

import { OUTBOUND_USER_AGENT } from "@/lib/resolution/types";
import { normalizeSeriesName } from "@/lib/series/normalize";

const ANILIST_ENDPOINT = "https://graphql.anilist.co";

export type AniListStatus = "FINISHED" | "RELEASING" | "NOT_YET_RELEASED" | "CANCELLED" | "HIATUS";

export type AniListMedia = {
  id: number;
  titles: string[];
  status: AniListStatus | null;
  volumes: number | null;
  format: string | null;
  countryOfOrigin: string | null;
};

/** Les origines dont les mangas/manhwas/manhuas arrivent en VF avec le même découpage. */
const ASIAN_ORIGINS = new Set(["JP", "KR", "CN", "TW"]);

const MEDIA_FIELDS = "id title { romaji english native } synonyms status volumes format countryOfOrigin";

type RawMedia = {
  id: number;
  title: { romaji: string | null; english: string | null; native: string | null };
  synonyms: string[] | null;
  status: AniListStatus | null;
  volumes: number | null;
  format: string | null;
  countryOfOrigin: string | null;
};

const toMedia = (raw: RawMedia): AniListMedia => ({
  id: raw.id,
  titles: [raw.title.romaji, raw.title.english, raw.title.native, ...(raw.synonyms ?? [])].filter(
    (title): title is string => typeof title === "string" && title.length > 0,
  ),
  status: raw.status,
  volumes: raw.volumes,
  format: raw.format,
  countryOfOrigin: raw.countryOfOrigin,
});

/** L'œuvre dont un titre ou synonyme est EXACTEMENT le nom de la série, manga d'origine asiatique — ou `null`. */
export function matchAniListStrict(seriesName: string, candidates: readonly AniListMedia[]): AniListMedia | null {
  const wanted = normalizeSeriesName(seriesName);
  if (!wanted) return null;
  return (
    candidates.find(
      (media) =>
        media.format === "MANGA" &&
        media.countryOfOrigin !== null &&
        ASIAN_ORIGINS.has(media.countryOfOrigin) &&
        media.titles.some((title) => normalizeSeriesName(title) === wanted),
    ) ?? null
  );
}

/** Ce que l'œuvre dit du fait de série : un total, une parution en cours, ou rien d'exploitable. */
export function factFromAniList(media: AniListMedia): { totalVolumes: number } | { isOngoing: true } | null {
  if (media.status === "RELEASING") return { isOngoing: true };
  if (media.status === "FINISHED" && media.volumes !== null && media.volumes >= 1) return { totalVolumes: media.volumes };
  return null;
}

export type AniListProvider = ReturnType<typeof createAniListProvider>;

export function createAniListProvider(fetchImplementation: typeof fetch = fetch, timeoutMs = 15_000) {
  async function query<T>(gql: string, variables: Record<string, unknown>): Promise<T> {
    const response = await fetchImplementation(ANILIST_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": OUTBOUND_USER_AGENT },
      body: JSON.stringify({ query: gql, variables }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`AniList : HTTP ${response.status}`);
    const payload = (await response.json()) as { data?: T; errors?: { message: string }[] };
    if (payload.errors?.length) throw new Error(`AniList : ${payload.errors[0].message}`);
    if (!payload.data) throw new Error("AniList : réponse sans données");
    return payload.data;
  }

  return {
    /** Les candidats d'une recherche par titre (5 au plus) — le rapprochement strict se fait ensuite, en pur. */
    async searchManga(title: string): Promise<AniListMedia[]> {
      const data = await query<{ Page: { media: RawMedia[] } }>(
        `query ($search: String) { Page(perPage: 5) { media(search: $search, type: MANGA, sort: SEARCH_MATCH) { ${MEDIA_FIELDS} } } }`,
        { search: title },
      );
      return data.Page.media.map(toMedia);
    },

    /** La relecture d'une œuvre déjà rapprochée (statut, volumes) — par id, stable. */
    async getManga(id: number): Promise<AniListMedia | null> {
      const data = await query<{ Media: RawMedia | null }>(`query ($id: Int) { Media(id: $id, type: MANGA) { ${MEDIA_FIELDS} } }`, { id });
      return data.Media ? toMedia(data.Media) : null;
    },
  };
}
