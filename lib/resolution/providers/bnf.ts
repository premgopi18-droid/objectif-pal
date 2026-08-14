/**
 * Le provider BnF — API SRU du catalogue général, gratuite, sans clé.
 * C'est le dépôt légal : tout ce qui est publié en France y est, par
 * obligation légale (95 % mesuré sur des ISBN réels — specs §5.2).
 * La BnF identifie mais n'illustre pas : jamais de couverture ici.
 */

import { OUTBOUND_USER_AGENT, PROVIDER_REQUEST_TIMEOUT_MILLISECONDS } from "@/lib/resolution/types";

const BNF_SRU_ENDPOINT = "https://catalogue.bnf.fr/api/SRU";

export type BnfRecord = {
  title: string | null;
  seriesName: string | null;
  issueNumber: string | null;
  authors: string | null;
  publisher: string | null;
  pageCount: number | null;
};

const decodeXmlEntities = (text: string): string =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

const firstTag = (xml: string, tag: string): string | null => {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`));
  return match ? decodeXmlEntities(match[1]).trim() : null;
};

/**
 * Parse une réponse SRU en Dublin Core. Exporté pour être testé sur des
 * fixtures réelles sans réseau.
 */
export function parseBnfResponse(xml: string): BnfRecord | null {
  const recordCount = xml.match(/<srw:numberOfRecords>(\d+)</)?.[1];
  if (!recordCount || recordCount === "0") return null;

  const rawTitle = firstTag(xml, "dc:title");
  // Format BnF typique : « Père & fils. 4 / Mi Tagawa » — le « / auteur » se jette
  // (dc:creator est plus propre), et un « . N » final est un numéro de tome.
  const titleWithoutAuthor = rawTitle ? rawTitle.split(" / ")[0].trim() : null;
  const tomeMatch = titleWithoutAuthor?.match(/^(.+?)\.\s*(?:Tome\s+)?(\d+)$/i) ?? null;

  const format = firstTag(xml, "dc:format"); // ex. « 1 vol. (206 p.) : ill. ; 18 cm »
  const pageMatch = format?.match(/(\d+)\s*p\./) ?? null;

  return {
    title: titleWithoutAuthor,
    seriesName: tomeMatch ? tomeMatch[1].trim() : null,
    issueNumber: tomeMatch ? tomeMatch[2] : null,
    authors: firstTag(xml, "dc:creator"),
    publisher: firstTag(xml, "dc:publisher"),
    pageCount: pageMatch ? Number(pageMatch[1]) : null,
  };
}

export type BnfProvider = ReturnType<typeof createBnfProvider>;

export function createBnfProvider(fetchImplementation: typeof fetch = fetch) {
  return {
    /** Identifie un ISBN au dépôt légal. `null` = introuvable (on descend d'un cran). */
    async resolveIsbn(isbn: string): Promise<BnfRecord | null> {
      const query = encodeURIComponent(`bib.isbn any "${isbn}"`);
      const url = `${BNF_SRU_ENDPOINT}?version=1.2&operation=searchRetrieve&query=${query}&recordSchema=dublincore&maximumRecords=1`;
      const response = await fetchImplementation(url, {
        headers: { "User-Agent": OUTBOUND_USER_AGENT },
        signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MILLISECONDS),
      });
      if (!response.ok) throw new Error(`BnF SRU : HTTP ${response.status}`);
      return parseBnfResponse(await response.text());
    },
  };
}
