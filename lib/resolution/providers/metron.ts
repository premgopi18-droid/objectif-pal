import { normalizeUpcForMetron } from "@/lib/resolution/barcode-router";
import { PROVIDER_REQUEST_TIMEOUT_MILLISECONDS } from "@/lib/resolution/types";

/**
 * Le provider Metron — enrichit la VO : couverture + `series_type` (le signal
 * de catégorie le plus fiable, specs §5.5). Basic Auth d'un compte de service,
 * CÔTÉ SERVEUR uniquement. Sert aussi d'identification de secours pour les
 * nouveautés VO que le dump GCD n'a pas encore (specs §6).
 *
 * Découverte mesurée (specs §5.4) : Metron ne référence que la couverture
 * PRINCIPALE — d'où la recherche en trois temps : gcd_id, UPC exact, puis UPC
 * normalisé (4ᵉ chiffre du supplément remis à 1).
 */

const METRON_ENDPOINT = "https://metron.cloud/api";

export type MetronIssue = {
  metronId: number;
  issueName: string | null;
  seriesName: string | null;
  number: string | null;
  coverUrl: string | null;
  seriesType: string | null;
  publisher: string | null;
  pageCount: number | null;
};

type MetronListItem = { id: number; issue?: string; number?: string; image?: string | null };
type MetronDetail = {
  id: number;
  number?: string;
  image?: string | null;
  page?: number | null;
  publisher?: { name?: string };
  series?: { name?: string; series_type?: { name?: string } };
};

export type MetronProvider = ReturnType<typeof createMetronProvider>;

export function createMetronProvider(
  credentials: { username: string | undefined; password: string | undefined } = {
    username: process.env.METRON_USERNAME,
    password: process.env.METRON_PASSWORD,
  },
  fetchImplementation: typeof fetch = fetch,
) {
  const authorization =
    credentials.username && credentials.password
      ? "Basic " + Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")
      : null;

  async function requestJson<T>(path: string): Promise<T> {
    if (!authorization) throw new Error("Identifiants Metron non configurés");
    const response = await fetchImplementation(`${METRON_ENDPOINT}${path}`, {
      headers: { Authorization: authorization, "User-Agent": "objectif-pal" },
      signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MILLISECONDS),
    });
    if (!response.ok) throw new Error(`Metron : HTTP ${response.status}`);
    return (await response.json()) as T;
  }

  async function firstListItem(path: string): Promise<MetronListItem | null> {
    const payload = await requestJson<{ count: number; results?: MetronListItem[] }>(path);
    return payload.count > 0 && payload.results?.[0] ? payload.results[0] : null;
  }

  async function toIssue(item: MetronListItem): Promise<MetronIssue> {
    // Le détail porte ce que la liste n'a pas : series_type, éditeur, pages.
    const detail = await requestJson<MetronDetail>(`/issue/${item.id}/`);
    return {
      metronId: item.id,
      issueName: item.issue ?? null,
      seriesName: detail.series?.name ?? null,
      number: detail.number ?? item.number ?? null,
      coverUrl: detail.image ?? item.image ?? null,
      seriesType: detail.series?.series_type?.name ?? null,
      publisher: detail.publisher?.name ?? null,
      pageCount: detail.page ?? null,
    };
  }

  return {
    /** Le filtre le plus précis : le gcd_id de la couverture principale. */
    async findIssueByGcdId(gcdId: number): Promise<MetronIssue | null> {
      if (!authorization) return null;
      const item = await firstListItem(`/issue/?gcd_id=${gcdId}`);
      return item ? toIssue(item) : null;
    },

    /** Par UPC : exact d'abord, puis normalisé sur la couverture principale. */
    async findIssueByUpc(upc: string): Promise<MetronIssue | null> {
      if (!authorization) return null;
      const candidates = [upc];
      const normalized = normalizeUpcForMetron(upc);
      if (normalized && normalized !== upc) candidates.push(normalized);

      for (const candidate of candidates) {
        const item = await firstListItem(`/issue/?upc=${candidate}`);
        if (item) return toIssue(item);
      }
      return null;
    },
  };
}
