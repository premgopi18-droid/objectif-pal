import { normalizeSeriesName } from "@/lib/series/normalize";

/**
 * Le rapprochement d'une série orpheline (sans lien GCD) avec une série
 * FRANÇAISE de GCD (#309) — pur, testé, jamais automatique : le script
 * `series:gcd-link-by-name` liste, Prem valide, puis `--apply`.
 *
 * Un nom seul est interdit (Spider-Man : 8 séries GCD françaises homonymes).
 * Il faut le même nom normalisé ET la même famille d'éditeur — une table
 * explicite de variantes, pas de regex floue — ET une année cohérente, et un
 * candidat UNIQUE. Deux candidats = rien, listé « ambigu ».
 */

export type GcdSeriesCandidate = {
  id: number;
  name: string | null;
  publisher: string | null;
  yearBegan: number | null;
  yearEnded: number | null;
  isCurrent: boolean | null;
  lastNumber: number | null;
};

/** Familles d'éditeur : la clé, ses variantes chez nous (BnF, saisie) et son nom chez GCD — normalisés à la comparaison. */
export const PUBLISHER_FAMILIES: readonly { key: string; gcdPublisher: string; variants: readonly string[] }[] = [
  { key: "panini", gcdPublisher: "Panini France", variants: ["panini", "panini comics", "panini france", "panini comics (nice)", "panini france (nice)", "panini family (nice)", "panini books"] },
  { key: "urban", gcdPublisher: "Urban Comics", variants: ["urban comics", "urban comics (paris)", "urban"] },
  { key: "glenat", gcdPublisher: "Glénat", variants: ["glenat", "glenat (grenoble)", "glenat (paris)", "editions glenat"] },
  { key: "lombard", gcdPublisher: "Le Lombard", variants: ["le lombard", "le lombard (bruxelles)", "lombard", "editions du lombard"] },
  { key: "delcourt", gcdPublisher: "Delcourt", variants: ["delcourt", "delcourt (paris)", "editions delcourt"] },
  { key: "taifu", gcdPublisher: "Taïfu Comics", variants: ["taifu comics", "taifu", "taifu comics (paris)"] },
  { key: "kioon", gcdPublisher: "Ki-oon", variants: ["ki-oon", "ki-oon (paris)", "kioon"] },
  { key: "pika", gcdPublisher: "Pika Édition", variants: ["pika", "pika edition", "pika (paris)", "pika edition (paris)"] },
  { key: "kana", gcdPublisher: "Kana", variants: ["kana", "kana (bruxelles)", "kana (paris)"] },
  { key: "kurokawa", gcdPublisher: "Kurokawa", variants: ["kurokawa", "kurokawa (paris)"] },
  { key: "dargaud", gcdPublisher: "Dargaud", variants: ["dargaud", "dargaud (paris)"] },
  { key: "dupuis", gcdPublisher: "Dupuis", variants: ["dupuis", "dupuis (marcinelle)", "dupuis (paris)"] },
  { key: "casterman", gcdPublisher: "Casterman", variants: ["casterman", "casterman (bruxelles)", "casterman (paris)"] },
  { key: "soleil", gcdPublisher: "Soleil", variants: ["soleil", "soleil (toulon)", "soleil productions"] },
];

/** Minuscules, sans accents, espaces et ponctuation d'apparat réduits — pour comparer des noms d'éditeur. */
const normalizePublisher = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,;:]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** La famille d'un éditeur tel qu'il apparaît sur un LIVRE chez nous, ou `null`. */
export function bookPublisherFamily(publisher: string | null): string | null {
  if (publisher === null) return null;
  const wanted = normalizePublisher(publisher);
  return PUBLISHER_FAMILIES.find((family) => family.variants.some((variant) => normalizePublisher(variant) === wanted))?.key ?? null;
}

/** La famille d'un éditeur tel que GCD le nomme, ou `null`. */
export function gcdPublisherFamily(publisher: string | null): string | null {
  if (publisher === null) return null;
  const wanted = normalizePublisher(publisher);
  return PUBLISHER_FAMILIES.find((family) => normalizePublisher(family.gcdPublisher) === wanted)?.key ?? null;
}

export type GcdLinkVerdict =
  /** `closedEdition` : la série GCD est close — une ancienne édition homonyme est possible, à vérifier à la main (review #312). */
  | { kind: "unique"; candidate: GcdSeriesCandidate; closedEdition: boolean }
  | { kind: "ambiguous"; candidates: GcdSeriesCandidate[] }
  | { kind: "none"; reason: "no-family" | "no-match" };

const isClosed = (candidate: GcdSeriesCandidate): boolean => candidate.isCurrent === false || candidate.yearEnded !== null;

/**
 * Le verdict : même nom normalisé, même famille d'éditeur, série GCD commencée
 * au plus tard l'année du plus ancien livre connu (sans année : pas de filtre),
 * dernier numéro d'une édition CLOSE au moins égal au plus grand tome possédé
 * (un tome 8 n'est pas d'une édition en 5 tomes — review #312), et UN seul
 * candidat.
 */
export function pickGcdCandidate(input: {
  seriesName: string;
  publisher: string | null;
  oldestYear: number | null;
  /** Le plus grand tome numérique des livres de la série chez nous, ou `null`. */
  maxOwnedNumber: number | null;
  candidates: readonly GcdSeriesCandidate[];
}): GcdLinkVerdict {
  const family = bookPublisherFamily(input.publisher);
  if (family === null) return { kind: "none", reason: "no-family" };
  const wanted = normalizeSeriesName(input.seriesName);
  const matching = input.candidates.filter(
    (candidate) =>
      candidate.name !== null &&
      normalizeSeriesName(candidate.name) === wanted &&
      gcdPublisherFamily(candidate.publisher) === family &&
      (input.oldestYear === null || candidate.yearBegan === null || candidate.yearBegan <= input.oldestYear) &&
      (input.maxOwnedNumber === null || !isClosed(candidate) || candidate.lastNumber === null || candidate.lastNumber >= input.maxOwnedNumber),
  );
  if (matching.length === 1) return { kind: "unique", candidate: matching[0], closedEdition: isClosed(matching[0]) };
  if (matching.length > 1) return { kind: "ambiguous", candidates: matching };
  return { kind: "none", reason: "no-match" };
}
