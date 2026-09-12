/**
 * La requête « autres éditions » (#277) — titre + auteur, pré-remplis depuis le
 * livre et MODIFIABLES (le titre résolu est parfois faux). Validation pure,
 * rejouée côté serveur : le formulaire n'est pas la garde.
 */

/** Même borne que les champs texte des livres (`MAX_TEXT_FIELD_LENGTH`, #179), en plus court : une requête n'est pas une fiche. */
export const EDITION_QUERY_MAX_LENGTH = 200;

export type EditionQuery = { title: string; author: string | null };

export type EditionQueryValidation = { ok: true; query: EditionQuery } | { ok: false; error: string };

export function validateEditionQuery(input: { title: string; author: string | null }): EditionQueryValidation {
  const title = input.title.trim().replace(/\s+/g, " ");
  const author = (input.author ?? "").trim().replace(/\s+/g, " ");
  if (title.length === 0) return { ok: false, error: "Un titre est nécessaire pour chercher d'autres éditions." };
  if (title.length > EDITION_QUERY_MAX_LENGTH || author.length > EDITION_QUERY_MAX_LENGTH) {
    return { ok: false, error: "La recherche est trop longue." };
  }
  return { ok: true, query: { title, author: author.length > 0 ? author : null } };
}

/**
 * L'auteur tel que le livre le porte, nettoyé pour une recherche : la BnF
 * renvoie « Fléchais, Amélie (1989-....). Auteur du texte » — on garde
 * le premier nom, sans dates ni rôle, sinon OpenLibrary ne trouve rien.
 */
export function authorForSearch(authors: string | null): string | null {
  if (!authors) return null;
  const first = authors.split(/[;,]/)[0]?.trim() ?? "";
  const cleaned = first
    .replace(/\(.*?\)/g, "")
    .replace(/\bAuteur du texte\b/gi, "")
    .trim()
    .replace(/[.,;:]+$/, "")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}
