/**
 * La clé de rapprochement d'une série par son nom (lot A de l'epic #289,
 * specs §4.17 décision 2) — le miroir TypeScript de `series.name_normalized`
 * en SQL (`regexp_replace(unaccent(lower(name)), '\s+', ' ', 'g')`, trim).
 *
 * « One Piece » (GCD) et « One piece » (BnF) doivent tomber sur la même ligne
 * du référentiel partagé : minuscules, sans accents ni ligatures (la même
 * normalisation que la recherche, #222), espaces réduits. Rien de plus — pas
 * de suppression de ponctuation ni de suffixe : le rapprochement au jugé est
 * interdit, le geste de fusion (lot B) fait le reste.
 */

import { normalizeForSearch } from "@/lib/search/entry-search";

export const normalizeSeriesName = (name: string): string =>
  normalizeForSearch(name).replace(/\s+/g, " ").trim();
