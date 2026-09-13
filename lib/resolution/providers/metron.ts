import { normalizeUpcForMetron } from "@/lib/resolution/barcode-router";
import { consumeGlobalQuota } from "@/lib/resolution/global-quota";
import { OUTBOUND_USER_AGENT, PROVIDER_REQUEST_TIMEOUT_MILLISECONDS, ProviderUnavailableError } from "@/lib/resolution/types";

/**
 * Le provider Metron — enrichit la VO : couverture + `series_type` (le signal
 * de catégorie le plus fiable, specs §5.5). Basic Auth d'un compte de service,
 * CÔTÉ SERVEUR uniquement. Sert aussi d'identification de secours pour les
 * nouveautés VO que le dump GCD n'a pas encore (specs §6).
 *
 * Les variantes (mesuré le 12/09/2026, #276) : le FILTRE de liste `?upc=` ne
 * connaît que l'UPC de la couverture principale — d'où la recherche en trois
 * temps : gcd_id, UPC exact, puis UPC normalisé (4ᵉ chiffre du supplément
 * remis à 1). Mais le DÉTAIL `/issue/{id}/` porte `variants[]`, chacune avec
 * son nom, son UPC et son image. Le détail étant déjà chargé, poser la
 * couverture de la variante scannée ne coûte aucun appel de plus.
 */

const METRON_ENDPOINT = "https://metron.cloud/api";

/** Une réponse non-ok ORDINAIRE (404, 400…) — ni throttle ni 5xx, qui sont des pannes (`ProviderUnavailableError`). */
export class MetronHttpError extends Error {
  constructor(public readonly status: number) {
    super(`Metron : HTTP ${status}`);
    this.name = "MetronHttpError";
  }
}

/** Une couverture alternative de l'issue — sans UPC pour les exclusivités boutique. */
export type MetronVariant = {
  name: string;
  upc: string | null;
  coverUrl: string;
};

export type MetronIssue = {
  metronId: number;
  issueName: string | null;
  seriesName: string | null;
  number: string | null;
  /** La couverture à POSER : celle de la variante scannée si Metron la connaît, sinon la principale. */
  coverUrl: string | null;
  /** La principale (cover A), telle que Metron l'expose sur l'issue. */
  mainCoverUrl: string | null;
  variants: MetronVariant[];
  /** L'UPC de la variante qui a matché le code scanné, ou null (principale ou inconnue). */
  matchedVariantUpc: string | null;
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
  variants?: { name?: string; upc?: string | null; image?: string | null }[];
};

export type MetronProvider = ReturnType<typeof createMetronProvider>;

export function createMetronProvider(
  credentials: { username: string | undefined; password: string | undefined } = {
    username: process.env.METRON_USERNAME,
    password: process.env.METRON_PASSWORD,
  },
  fetchImplementation: typeof fetch = fetch,
  // Le quota GLOBAL (#175) — 20 req/min pour LE compte, partagé par tous ; un
  // lookup peut coûter jusqu'à 4 appels HTTP, chacun consomme un tick.
  consumeQuota: () => Promise<boolean> = () => consumeGlobalQuota("metron"),
) {
  const authorization =
    credentials.username && credentials.password
      ? "Basic " + Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")
      : null;

  async function requestJson<T>(path: string): Promise<T> {
    if (!authorization) throw new Error("Identifiants Metron non configurés");
    if (!(await consumeQuota())) {
      throw new ProviderUnavailableError("Metron", "quota global (req/min) épuisé");
    }
    const response = await fetchImplementation(`${METRON_ENDPOINT}${path}`, {
      headers: { Authorization: authorization, "User-Agent": OUTBOUND_USER_AGENT },
      signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MILLISECONDS),
    });
    // Panne ≠ absence (#175) : throttle/5xx = compte indisponible, pas un
    // verdict — et le compte de service partagé ne doit JAMAIS être martelé.
    if (response.status === 429 || response.status >= 500) {
      throw new ProviderUnavailableError("Metron", `HTTP ${response.status}`);
    }
    if (!response.ok) throw new MetronHttpError(response.status);
    return (await response.json()) as T;
  }

  async function firstListItem(path: string): Promise<MetronListItem | null> {
    const payload = await requestJson<{ count: number; results?: MetronListItem[] }>(path);
    return payload.count > 0 && payload.results?.[0] ? payload.results[0] : null;
  }

  /** Les variantes exploitables : une image, sinon rien à montrer. */
  const parseVariants = (detail: MetronDetail): MetronVariant[] =>
    (detail.variants ?? []).flatMap((variant) =>
      variant.image ? [{ name: variant.name?.trim() || "Variante", upc: variant.upc || null, coverUrl: variant.image }] : [],
    );

  async function toIssue(item: MetronListItem, scannedUpc: string | null): Promise<MetronIssue> {
    // Le détail porte ce que la liste n'a pas : series_type, éditeur, pages —
    // et les variantes (#276).
    const detail = await requestJson<MetronDetail>(`/issue/${item.id}/`);
    const variants = parseVariants(detail);
    const matched = scannedUpc ? (variants.find((variant) => variant.upc === scannedUpc) ?? null) : null;
    const mainCoverUrl = detail.image ?? item.image ?? null;
    return {
      metronId: item.id,
      // Par identifiant direct la liste n'a pas été lue : le nom vient du détail.
      issueName: item.issue ?? (detail.series?.name && detail.number ? `${detail.series.name} #${detail.number}` : null),
      seriesName: detail.series?.name ?? null,
      number: detail.number ?? item.number ?? null,
      coverUrl: matched?.coverUrl ?? mainCoverUrl,
      mainCoverUrl,
      variants,
      matchedVariantUpc: matched?.upc ?? null,
      seriesType: detail.series?.series_type?.name ?? null,
      publisher: detail.publisher?.name ?? null,
      pageCount: detail.page ?? null,
    };
  }

  return {
    /**
     * Le filtre le plus précis : le gcd_id de la couverture principale. Le code
     * scanné, s'il est connu, sert à choisir la variante (#276).
     */
    async findIssueByGcdId(gcdId: number, scannedUpc: string | null = null): Promise<MetronIssue | null> {
      if (!authorization) return null;
      const item = await firstListItem(`/issue/?gcd_id=${gcdId}`);
      return item ? toIssue(item, scannedUpc) : null;
    },

    /** Par UPC : exact d'abord, puis normalisé sur la couverture principale. */
    async findIssueByUpc(upc: string): Promise<MetronIssue | null> {
      if (!authorization) return null;
      const upcsToTry = [upc];
      const normalized = normalizeUpcForMetron(upc);
      if (normalized && normalized !== upc) upcsToTry.push(normalized);

      for (const candidate of upcsToTry) {
        // Encodé (audit #274) : le code vient de la base, jamais brut dans une
        // requête authentifiée du compte de service.
        const item = await firstListItem(`/issue/?upc=${encodeURIComponent(candidate)}`);
        if (item) return toIssue(item, upc);
      }
      return null;
    },

    /**
     * Par identifiant Metron connu (`books.metadata_source_id` d'un livre résolu
     * chez eux) : le DÉTAIL directement — UN tick au lieu de deux ou trois
     * (audit #274 : le quota Metron est le plus rare de l'app et il est partagé
     * avec le scan). Le code scanné choisit la variante comme ailleurs.
     */
    async findIssueById(metronId: number, scannedUpc: string | null = null): Promise<MetronIssue | null> {
      if (!authorization || !Number.isInteger(metronId) || metronId <= 0) return null;
      try {
        return await toIssue({ id: metronId }, scannedUpc);
      } catch (error) {
        // Un 404 (issue supprimée chez eux) est une absence, pas une panne —
        // décidé sur le STATUT typé, jamais sur le texte du message (review #286).
        if (error instanceof MetronHttpError && error.status === 404) return null;
        throw error;
      }
    },
  };
}
