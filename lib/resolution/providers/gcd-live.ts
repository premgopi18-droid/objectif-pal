import { OUTBOUND_USER_AGENT, ProviderUnavailableError } from "@/lib/resolution/types";

/**
 * L'API REST publique de la Grand Comics Database (#308, §4.17-4) — sondée le
 * 14/09/2026 : JSON, sans clé, derrière Cloudflare, sans recherche (pas de
 * filtre par nom, ISBN ni code-barres : `?name=` est ignoré). Elle sert donc
 * UNE chose : relire une série DÉJÀ reliée (fin, fascicules parus) et ses
 * fascicules nouveaux (ISBN, code-barres) — sans attendre le dump.
 *
 * Deux parseurs purs (`parseGcdSeries`, `parseGcdIssue`) sur fixtures réelles,
 * et un provider qui ne fait que chercher. Panne ≠ absence : 404 = `null`,
 * 403/429/5xx = `ProviderUnavailableError`, JSON invalide = erreur.
 * Données CC BY-SA 4.0 — l'attribution GCD de l'app couvre l'API comme le dump.
 */

export const GCD_API_BASE_URL = "https://www.comics.org/api";
export const GCD_LIVE_TIMEOUT_MS = 10_000;

/** Ce que l'API dit d'une série — le strict nécessaire pour `gcd_series`. */
export type GcdLiveSeries = {
  name: string;
  yearBegan: number | null;
  yearEnded: number | null;
  /** Les fascicules actifs, dans l'ordre de GCD (id en fin d'URL). */
  issueIds: number[];
  /** Le plus grand numéro numérique des fascicules (même règle que l'export : cinq chiffres au plus), ou `null`. */
  lastNumber: number | null;
  issueCount: number;
};

/** Un fascicule normalisé comme l'export (`scripts/gcd-export.mjs`) : prêt pour `gcd_issues`. */
export type GcdLiveIssue = {
  gcdId: number;
  seriesId: number | null;
  number: string | null;
  title: string | null;
  keyDate: string | null;
  /** Chiffres et X seulement — l'ISBN de GCD porte des tirets. */
  isbn: string | null;
  /** Un fascicule peut porter plusieurs codes (variantes) : une ligne par code chez nous. */
  barcodes: string[];
  pageCount: number | null;
};

/**
 * Le numéro d'un fascicule GCD n'est pas toujours un nombre (« [nn] », « 20.1 »,
 * « Annual 1 ») : n'est retenu qu'un entier de cinq chiffres au plus — la
 * règle de `lastNumberOf` dans `scripts/gcd-export.mjs` et de la RPC
 * `gcd_series_max_issue_numbers` (`^\d{1,5}$`).
 */
export function numericIssueNumber(number: string | null | undefined): number | null {
  if (number === null || number === undefined) return null;
  const trimmed = number.trim();
  return /^\d{1,5}$/.test(trimmed) ? Number(trimmed) : null;
}

const ISSUE_ID_PATTERN = /\/api\/issue\/(\d+)\/?/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const stringOrNull = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);
const integerOrNull = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
};

/** « 2 - Le fils du démon » → « 2 » ; « 0 » → « 0 » ; « [nn] » → « [nn] ». */
const descriptorNumber = (descriptor: string): string => descriptor.split(" - ")[0] ?? descriptor;

/** La série telle que l'API la sert, ou `null` si le JSON n'en est pas une (pas de nom). */
export function parseGcdSeries(json: unknown): GcdLiveSeries | null {
  if (!isRecord(json)) return null;
  const name = stringOrNull(json.name);
  if (name === null) return null;
  const issueIds = (Array.isArray(json.active_issues) ? json.active_issues : []).flatMap((url) => {
    const id = typeof url === "string" ? url.match(ISSUE_ID_PATTERN)?.[1] : undefined;
    return id === undefined ? [] : [Number(id)];
  });
  const numbers = (Array.isArray(json.issue_descriptors) ? json.issue_descriptors : []).flatMap((descriptor) => {
    const number = typeof descriptor === "string" ? numericIssueNumber(descriptorNumber(descriptor)) : null;
    return number === null ? [] : [number];
  });
  return {
    name,
    yearBegan: integerOrNull(json.year_began),
    yearEnded: integerOrNull(json.year_ended),
    issueIds,
    lastNumber: numbers.length === 0 ? null : Math.max(...numbers),
    issueCount: issueIds.length,
  };
}

/** Le fascicule normalisé comme l'export, ou `null` sans identifiant. */
export function parseGcdIssue(json: unknown): GcdLiveIssue | null {
  if (!isRecord(json)) return null;
  const gcdId = typeof json.api_url === "string" ? json.api_url.match(ISSUE_ID_PATTERN)?.[1] : undefined;
  if (gcdId === undefined) return null;
  const seriesId = typeof json.series === "string" ? json.series.match(/\/api\/series\/(\d+)\/?/)?.[1] : undefined;
  const isbn = (stringOrNull(json.isbn) ?? "").replace(/[^\dX]/gi, "");
  // Même découpage que l'export : GCD sépare parfois plusieurs codes par « ; » ou espace.
  const barcodes = (stringOrNull(json.barcode) ?? "").split(/[;\s]+/).filter((code) => /^\d{8,}$/.test(code));
  // « 232.000 » : GCD sert un décimal ; chez nous un entier.
  const pageCount = typeof json.page_count === "string" && /^\d+(\.\d+)?$/.test(json.page_count) ? Math.round(Number(json.page_count)) : null;
  return {
    gcdId: Number(gcdId),
    seriesId: seriesId === undefined ? null : Number(seriesId),
    number: stringOrNull(json.number),
    title: stringOrNull(json.title),
    keyDate: stringOrNull(json.key_date),
    isbn: isbn === "" ? null : isbn,
    barcodes,
    pageCount,
  };
}

export type GcdLiveProvider = ReturnType<typeof createGcdLiveProvider>;

export function createGcdLiveProvider(fetchImplementation: typeof fetch = fetch, timeoutMs = GCD_LIVE_TIMEOUT_MS) {
  async function get(path: string): Promise<unknown | null> {
    const response = await fetchImplementation(`${GCD_API_BASE_URL}/${path}/?format=json`, {
      headers: { Accept: "application/json", "User-Agent": OUTBOUND_USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 404) return null;
    // 403 = Cloudflare qui refuse, 429 = trop vite, 5xx = panne : jamais une absence.
    if (response.status === 403 || response.status === 429 || response.status >= 500) {
      throw new ProviderUnavailableError("GCD", `HTTP ${response.status}`);
    }
    if (!response.ok) throw new Error(`GCD : HTTP ${response.status}`);
    return response.json();
  }

  return {
    /** Une série par id GCD — `null` si elle n'existe plus (fusionnée ou supprimée côté GCD). */
    async getSeries(id: number): Promise<GcdLiveSeries | null> {
      const json = await get(`series/${id}`);
      return json === null ? null : parseGcdSeries(json);
    },

    /** Un fascicule par id GCD — `null` s'il n'existe plus. */
    async getIssue(id: number): Promise<GcdLiveIssue | null> {
      const json = await get(`issue/${id}`);
      return json === null ? null : parseGcdIssue(json);
    },
  };
}
