import { consumeGlobalQuota } from "@/lib/resolution/global-quota";
import { OUTBOUND_USER_AGENT, PROVIDER_REQUEST_TIMEOUT_MILLISECONDS, ProviderUnavailableError } from "@/lib/resolution/types";

/**
 * Le provider Comic Vine (#279, lot C de l'epic #274) — la plus large base VO,
 * indés et Kickstarter compris, là où Metron s'arrête. Conditions relues le
 * 12/09/2026 : clé gratuite, **usage non commercial strict** (l'app l'est,
 * §5.4), 200 requêtes par ressource et par heure, mise en cache et **lien
 * retour** obligatoires, et « ne pas reproduire sur un autre support » — d'où
 * : jamais rapatrié (lien direct, comme epagine), jamais dans la cascade du
 * scan, seulement dans les candidates de la feuille.
 *
 * **Débranchable par une variable** : sans `COMIC_VINE_API_KEY`, le provider
 * est muet — rien n'apparaît, rien n'est appelé (motif Google Books). Retirer
 * la variable sur Vercel suffit ; `scripts/covers-comicvine-detach.mts`
 * re-résout les livres qui pointaient chez eux.
 *
 * Leur API n'a pas de code-barres : on cherche le VOLUME par nom (+ année de
 * début la plus proche), puis l'issue par numéro. `image` = la couverture
 * principale, `associated_images[]` = les variantes, avec légende. Un UA
 * identifiant est obligatoire (403 mesuré sans).
 */

const COMIC_VINE_API = "https://comicvine.gamespot.com/api";

export type ComicVineCover = {
  url: string;
  caption: string | null;
  /** Le lien retour exigé par leurs conditions — vers la page de l'issue. */
  comicVineUrl: string | null;
};

type VolumeResult = { id?: number; name?: string; start_year?: string | number | null };
type IssueResult = {
  id?: number;
  site_detail_url?: string;
  image?: { original_url?: string; medium_url?: string } | null;
  associated_images?: { original_url?: string; caption?: string | null }[];
};
type Envelope<T> = { status_code?: number; error?: string; results?: T };

/** Comparaison de noms de série sans casse, accents, ponctuation ni « the ». */
const normalizeName = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bthe\b/g, "")
    .trim();

export type ComicVineProvider = ReturnType<typeof createComicVineProvider>;

export function createComicVineProvider(
  apiKey: string | undefined = process.env.COMIC_VINE_API_KEY,
  fetchImplementation: typeof fetch = fetch,
  // 200/h par ressource chez eux ; 150/h global chez nous (marge), en SQL.
  consumeQuota: () => Promise<boolean> = () => consumeGlobalQuota("comic_vine_hourly"),
) {
  async function requestJson<T>(path: string, params: Record<string, string>): Promise<T> {
    if (!apiKey) throw new Error("Comic Vine non configuré");
    if (!(await consumeQuota())) throw new ProviderUnavailableError("Comic Vine", "quota global (req/h) épuisé");
    const search = new URLSearchParams({ ...params, api_key: apiKey, format: "json" });
    const response = await fetchImplementation(`${COMIC_VINE_API}${path}?${search.toString()}`, {
      headers: { "User-Agent": OUTBOUND_USER_AGENT },
      signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MILLISECONDS),
    });
    // 401/403 (clé, UA), 420 (« velocity »), 429, 5xx : la source est en rade —
    // panne ≠ absence (#175). Jamais l'URL dans une erreur : la clé y voyage.
    if ([401, 403, 420, 429].includes(response.status) || response.status >= 500) {
      throw new ProviderUnavailableError("Comic Vine", `HTTP ${response.status}`);
    }
    if (!response.ok) throw new Error(`Comic Vine : HTTP ${response.status}`);
    const envelope = (await response.json()) as Envelope<T>;
    // Leur API répond 200 avec un status_code d'erreur (100 = clé invalide, mesuré).
    if (envelope.status_code !== undefined && envelope.status_code !== 1) {
      throw new ProviderUnavailableError("Comic Vine", `status ${envelope.status_code}`);
    }
    return (envelope.results ?? ([] as unknown)) as T;
  }

  return {
    /** Muet sans clé : le lot est livrable clé absente, et se débranche en la retirant. */
    isEnabled(): boolean {
      return Boolean(apiKey);
    },

    /**
     * Les couvertures d'une issue — principale puis variantes légendées —
     * pour une série et un numéro. Deux appels (volume, issue) = deux ticks.
     * `[]` sans clé, sans volume qui matche, ou sans image.
     */
    async findIssueCovers(query: { seriesName: string; issueNumber: string; startYear: number | null }): Promise<ComicVineCover[]> {
      if (!apiKey) return [];
      const seriesName = query.seriesName.trim();
      const issueNumber = query.issueNumber.trim();
      if (seriesName.length === 0 || issueNumber.length === 0) return [];

      const volumes = await requestJson<VolumeResult[]>("/search/", {
        resources: "volume",
        query: seriesName,
        limit: "10",
        field_list: "id,name,start_year",
      });
      const volume = pickVolume(volumes, seriesName, query.startYear);
      if (!volume) return [];

      const issues = await requestJson<IssueResult[]>("/issues/", {
        filter: `volume:${volume.id},issue_number:${issueNumber}`,
        field_list: "id,image,associated_images,site_detail_url",
        limit: "1",
      });
      const issue = issues[0];
      if (!issue) return [];
      const comicVineUrl = issue.site_detail_url ?? null;
      const covers: ComicVineCover[] = [];
      const main = issue.image?.original_url ?? issue.image?.medium_url;
      if (main) covers.push({ url: main, caption: null, comicVineUrl });
      for (const associated of issue.associated_images ?? []) {
        if (associated.original_url) covers.push({ url: associated.original_url, caption: associated.caption?.trim() || null, comicVineUrl });
      }
      // Dédoublonnage par URL, ordre conservé.
      const seen = new Set<string>();
      return covers.filter((cover) => (seen.has(cover.url) ? false : (seen.add(cover.url), true)));
    },
  };
}

/**
 * Le volume à retenir (review #284) : égalité stricte du nom normalisé d'abord,
 * sinon un PRÉFIXE (l'un des noms commence par l'autre — un sous-titre en plus
 * d'un côté, « Season Two »…) ; dans les deux cas, l'année de début la plus
 * proche départage les homonymes (Nightwing 1996 / 2016).
 */
export function pickVolume(volumes: VolumeResult[], seriesName: string, startYear: number | null): (VolumeResult & { id: number }) | null {
  const wanted = normalizeName(seriesName);
  if (wanted.length === 0) return null;
  const named = volumes.filter((volume): volume is VolumeResult & { id: number; name: string } => typeof volume.id === "number" && typeof volume.name === "string");
  const exact = named.filter((volume) => normalizeName(volume.name) === wanted);
  const candidates =
    exact.length > 0
      ? exact
      : named.filter((volume) => {
          const name = normalizeName(volume.name);
          return name.length > 0 && (name.startsWith(`${wanted} `) || wanted.startsWith(`${name} `));
        });
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => yearDistance(a, startYear) - yearDistance(b, startYear))[0];
}

const yearDistance = (volume: VolumeResult, startYear: number | null): number => {
  if (startYear === null) return 0;
  const year = Number(volume.start_year);
  return Number.isFinite(year) ? Math.abs(year - startYear) : Number.MAX_SAFE_INTEGER;
};
