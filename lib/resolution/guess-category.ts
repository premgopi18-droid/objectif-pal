import type { BookCategory } from "@/lib/scoring/types";
import type { MetadataSource } from "@/lib/resolution/types";

/**
 * Deviner la catégorie du barème — specs §5.5. La catégorie est PROPOSÉE,
 * jamais imposée : pour la VF on n'a que des indices (éditeur, pages, langue),
 * ça se trompera parfois, et c'est pour ça que la correction en un tap est
 * une exigence, pas une option.
 */

/** Normalise pour comparer des noms d'éditeurs (casse, accents, ponctuation). */
const normalizePublisherName = (name: string): string =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // les diacritiques décomposés par NFD
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Les listes d'éditeurs des specs §5.5 — extensibles à l'usage. Le match est
 * un `includes` sur le nom normalisé : « Éditions Glénat » matche « glenat ».
 * Glénat publie aussi de la BD : les specs le rangent côté manga, la
 * correction en un tap fait le reste.
 */
const MANGA_PUBLISHERS_FR = ["glenat", "kana", "pika", "kurokawa", "ki oon", "kaze", "ankama"] as const;
const FRANCO_BELGIAN_PUBLISHERS = ["dargaud", "dupuis", "lombard", "casterman", "delcourt", "bamboo"] as const;
const COMICS_PUBLISHERS_FR = ["panini", "urban"] as const;

/** Catégorie proposée à partir du seul éditeur (signal BnF / Google Books). */
/**
 * La catégorie proposée est-elle une DEVINETTE ? (specs §5.5, #101 lot C)
 *
 * GCD et Metron portent un vrai `series_type` : la catégorie en découle, elle
 * n'est pas inférée. La VF, elle, n'a que des indices — éditeur, pages, langue,
 * rayons Google Books —, et c'est le point ouvert connu des specs.
 *
 * Sert à marquer d'un « ? » les seules lignes où le doute existe : en rafale,
 * signaler partout revient à ne rien signaler.
 */
export function isCategoryGuessed(source: MetadataSource): boolean {
  return source !== "gcd" && source !== "metron";
}

export function guessCategoryFromPublisher(publisher: string | null): BookCategory | null {
  if (!publisher) return null;
  const normalized = normalizePublisherName(publisher);
  const matches = (keywords: readonly string[]) => keywords.some((keyword) => normalized.includes(keyword));

  if (matches(MANGA_PUBLISHERS_FR)) return "manga";
  if (matches(FRANCO_BELGIAN_PUBLISHERS)) return "bd";
  if (matches(COMICS_PUBLISHERS_FR)) return "comics";
  return null;
}

/** Catégorie proposée à partir du `series_type` Metron — le signal le plus fiable. */
export function guessCategoryFromMetronSeriesType(seriesType: string | null): BookCategory | null {
  if (!seriesType) return null;
  const normalized = seriesType.toLowerCase();
  if (normalized.includes("omnibus")) return "omnibus";
  if (["trade paperback", "hardcover", "graphic novel"].some((type) => normalized.includes(type))) return "comics";
  if (
    ["single issue", "one-shot", "one shot", "annual", "limited series", "ongoing series"].some((type) =>
      normalized.includes(type),
    )
  ) {
    return "issue";
  }
  return null;
}

/** Catégorie proposée à partir des catégories Google Books (dernier signal). */
export function guessCategoryFromGoogleBooksCategories(categories: string[] | null): BookCategory | null {
  if (!categories || categories.length === 0) return null;
  const joined = categories.join(" ").toLowerCase();
  if (/comics|graphic/.test(joined)) return "comics";
  if (/fiction|literary|novel/.test(joined)) return "roman";
  return null;
}
