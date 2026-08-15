/**
 * La recherche des listes (issue #222) — LA normalisation commune : la Biblio
 * (en mémoire), la PAL (en mémoire) et l'aiguille du Journal (envoyée au SQL)
 * doivent parler la même langue, sinon « asterix » trouve Astérix sur une
 * page et pas sur l'autre.
 *
 * Parité avec le SQL (`unaccent` de la vue journal_entries) : NFD + strip des
 * diacritiques combinants (la règle historique de la Biblio, #63) NE décompose
 * PAS les ligatures — « cœur » resterait « cœur » quand unaccent dit « coeur ».
 * On mappe donc œ/æ explicitement, des deux côtés du clavier français.
 */

export const normalizeForSearch = (text: string): string =>
  text
    .toLowerCase()
    // Les ligatures d'abord : NFD ne les décompose pas, unaccent (SQL) si.
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    // La plage des diacritiques combinants, en échappé : lisible, et insensible
    // à une normalisation d'encodage accidentelle du fichier (review #63).
    .replace(/[̀-ͯ]/g, "");

/** Le prédicat commun : titre OU série contient l'aiguille (déjà trim/normalisée en interne). */
export function matchesSearch<T>(
  entry: T,
  searchText: string,
  get: { title: (entry: T) => string; seriesName: (entry: T) => string | null },
): boolean {
  const needle = normalizeForSearch(searchText.trim());
  if (!needle) return true;
  const seriesName = get.seriesName(entry);
  return (
    normalizeForSearch(get.title(entry)).includes(needle) ||
    (seriesName !== null && normalizeForSearch(seriesName).includes(needle))
  );
}

/**
 * Échappe une aiguille destinée à un motif `ilike` (#222) : `%`, `_` et `\`
 * sont des JOKERS SQL — un titre « 100% » ou « Mister_X » tapé tel quel doit
 * chercher ces caractères, pas ouvrir le motif.
 */
export const escapeIlikePattern = (needle: string): string => needle.replace(/[\\%_]/g, "\\$&");
