/**
 * Le provider BnF — API SRU du catalogue général, gratuite, sans clé.
 * C'est le dépôt légal : tout ce qui est publié en France y est, par
 * obligation légale (95 % mesuré sur des ISBN réels — specs §5.2).
 * La BnF identifie mais n'illustre pas : jamais de couverture ici.
 *
 * Depuis le lot 0 de l'epic séries (#290, specs §4.17), on lit la notice
 * UNIMARC (`recordSchema=unimarcXchange`) et plus le Dublin Core : le titre
 * DC était le titre d'ÉPISODE (« Ace entre en scène ») et la série se
 * perdait. Mesuré sur 80 ISBN BnF de la base : 7 séries captées en DC, 40 par
 * la seule zone 461. Les zones lues :
 *   - 461 `$t` titre d'ensemble (la série), `$v` numéro de tome, `$0` numéro
 *     de la notice de série — l'identifiant stable qui reliera les comptes ;
 *   - 200 `$a` titre propre, `$e` complément, `$h` numéro de partie, `$i`
 *     titre de partie ;
 *   - 700/701 auteurs (`$a` nom, `$b` prénom), repli 200 `$f` ;
 *   - 214 puis 210 `$c` éditeur ; 215 `$a` pagination.
 * Le 225 (collection) est volontairement IGNORÉ : son `$v` est un numéro de
 * collection pour les romans (« Le livre de poche 34028 »), pas un tome.
 */

import { OUTBOUND_USER_AGENT, PROVIDER_REQUEST_TIMEOUT_MILLISECONDS } from "@/lib/resolution/types";
import { parseVolumeNumber } from "@/lib/resolution/volume-number";

const BNF_SRU_ENDPOINT = "https://catalogue.bnf.fr/api/SRU";

export type BnfRecord = {
  title: string | null;
  seriesName: string | null;
  issueNumber: string | null;
  /** Le `$0` de la zone 461 : la notice de série, stable d'un tome à l'autre. */
  bnfSeriesId: string | null;
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

/** Une zone UNIMARC : ses sous-zones dans l'ordre de la notice (une lettre peut se répéter). */
type DataField = { code: string; value: string }[];

const DATAFIELD_PATTERN = /<(?:mxc:)?datafield tag="(\d{3})"[^>]*>([^]*?)<\/(?:mxc:)?datafield>/g;
const SUBFIELD_PATTERN = /<(?:mxc:)?subfield code="(\w)">([^<]*)<\/(?:mxc:)?subfield>/g;

/** Toutes les zones de la PREMIÈRE notice, groupées par étiquette. */
function readDataFields(xml: string): Map<string, DataField[]> {
  const fields = new Map<string, DataField[]>();
  for (const [, tag, body] of xml.matchAll(DATAFIELD_PATTERN)) {
    const subfields: DataField = [];
    for (const [, code, value] of body.matchAll(SUBFIELD_PATTERN)) {
      const text = decodeXmlEntities(value).trim();
      if (text) subfields.push({ code, value: text });
    }
    fields.set(tag, [...(fields.get(tag) ?? []), subfields]);
  }
  return fields;
}

const subfield = (field: DataField | undefined, code: string): string | null =>
  field?.find((entry) => entry.code === code)?.value ?? null;

/**
 * Le titre d'ensemble tel qu'on l'affiche : coupé au premier « / » (la BnF y
 * colle parfois la mention de responsabilité — « Fables / scénario, Bill
 * Willingham »), espaces réduits. La casse BnF est conservée : le nom
 * canonique est l'affaire du référentiel de séries (lot A).
 */
const cleanSeriesName = (raw: string | null): string | null => {
  if (!raw) return null;
  const cleaned = raw.split(" / ")[0].replace(/\s+/g, " ").trim();
  return cleaned || null;
};

/**
 * Dernier repli quand la notice n'a ni 461 ni 200 `$h` : le titre lui-même
 * porte le tome (« Abaddon T02 », « Père & fils. 4 », « Radiant Tome 3 »).
 * Deux formes seulement, pour ne jamais lire « Fahrenheit 451 » comme le
 * tome 451 de « Fahrenheit ».
 */
const TITLE_WITH_VOLUME_PATTERN = /^(.+?)(?:\.\s*(?:tome\s+)?|\s+(?:tome|t\.?|vol\.?|volume)\s*)0*(\d+)$/i;

const splitTitleAndVolume = (title: string): { seriesName: string; issueNumber: string } | null => {
  const match = TITLE_WITH_VOLUME_PATTERN.exec(title);
  if (!match) return null;
  const seriesName = match[1].trim();
  if (!seriesName || /^\d+$/.test(seriesName)) return null;
  return { seriesName, issueNumber: String(Number(match[2])) };
};

/**
 * Une anthologie peut porter des dizaines de 701 : au-delà, la liste dépasse
 * le plafond de `validateBook` (1 000 caractères) et le scan refuserait un
 * livre parfaitement identifié (review #294). Six noms suffisent à l'affichage.
 */
export const MAX_LISTED_AUTHORS = 6;

const formatAuthorList = (names: string[]): string =>
  names.length > MAX_LISTED_AUTHORS ? `${names.slice(0, MAX_LISTED_AUTHORS).join(", ")} et al.` : names.join(", ");

/** « Nom, Prénom » chez la BnF → « Prénom Nom » pour l'affichage. */
const personName = (field: DataField): string | null => {
  const lastName = subfield(field, "a");
  const firstName = subfield(field, "b");
  if (!lastName) return null;
  return firstName ? `${firstName} ${lastName}` : lastName;
};

/**
 * Parse une réponse SRU en UNIMARC (marcxchange). Exporté pour être testé
 * sur des fixtures réelles sans réseau.
 */
export function parseBnfResponse(xml: string): BnfRecord | null {
  const recordCount = xml.match(/<srw:numberOfRecords>(\d+)</)?.[1];
  if (!recordCount || recordCount === "0") return null;

  const fields = readDataFields(xml);
  const titleField = fields.get("200")?.[0];
  const seriesField = fields.get("461")?.[0];

  const mainTitle = subfield(titleField, "a");
  // Une notice comptée mais sans titre propre n'identifie rien : on descend
  // d'un cran (Google Books) plutôt que de rendre un livre au titre vide
  // (review #294).
  if (!mainTitle) return null;
  const subtitle = subfield(titleField, "e");
  const partNumber = subfield(titleField, "h");
  const partTitle = subfield(titleField, "i");
  const baseTitle = subtitle ? `${mainTitle} : ${subtitle}` : mainTitle;
  const title = partTitle ? `${baseTitle}. ${partTitle}` : baseTitle;

  // La série, du plus sûr au moins sûr : 461 → 200 $h (la série est alors le
  // titre propre) → le titre qui porte lui-même son tome.
  let seriesName = cleanSeriesName(subfield(seriesField, "t"));
  let issueNumber = parseVolumeNumber(subfield(seriesField, "v")) ?? parseVolumeNumber(partNumber);
  if (!seriesName && partNumber && issueNumber) seriesName = cleanSeriesName(mainTitle);
  if (!seriesName) {
    const split = splitTitleAndVolume(mainTitle);
    if (split) ({ seriesName, issueNumber } = split);
  }

  const authorFields = [...(fields.get("700") ?? []), ...(fields.get("701") ?? [])];
  const authorNames = authorFields.map(personName).filter((name): name is string => name !== null);
  const authors = authorNames.length > 0 ? formatAuthorList(authorNames) : subfield(titleField, "f");

  const publisher = subfield(fields.get("214")?.[0], "c") ?? subfield(fields.get("210")?.[0], "c");
  const pageMatch = subfield(fields.get("215")?.[0], "a")?.match(/(\d+)\]?\s*p\./) ?? null;

  return {
    title,
    seriesName,
    issueNumber: seriesName ? issueNumber : null,
    bnfSeriesId: seriesName ? subfield(seriesField, "0") : null,
    authors,
    publisher,
    pageCount: pageMatch ? Number(pageMatch[1]) : null,
  };
}

export type BnfProvider = ReturnType<typeof createBnfProvider>;

export function createBnfProvider(fetchImplementation: typeof fetch = fetch) {
  return {
    /** Identifie un ISBN au dépôt légal. `null` = introuvable (on descend d'un cran). */
    async resolveIsbn(isbn: string): Promise<BnfRecord | null> {
      const query = encodeURIComponent(`bib.isbn any "${isbn}"`);
      const url = `${BNF_SRU_ENDPOINT}?version=1.2&operation=searchRetrieve&query=${query}&recordSchema=unimarcXchange&maximumRecords=1`;
      const response = await fetchImplementation(url, {
        headers: { "User-Agent": OUTBOUND_USER_AGENT },
        signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MILLISECONDS),
      });
      if (!response.ok) throw new Error(`BnF SRU : HTTP ${response.status}`);
      return parseBnfResponse(await response.text());
    },
  };
}
