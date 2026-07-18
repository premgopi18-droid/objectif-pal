import type { Database } from "@/lib/supabase/database.types";
import type { BookInput } from "@/lib/books/actions";

/**
 * La fusion des métadonnées au RESCAN (specs §4.2), extraite pour être testée
 * sans toucher Supabase. L'utilisateur vient de VOIR (et éventuellement
 * corriger) la feuille : son titre et sa catégorie font foi, ils sont TOUJOURS
 * appliqués (la catégorie détermine les points au barème, et aucune autre UI
 * ne la corrige). Les autres métadonnées ne font que COMBLER les trous : une
 * valeur non-null en base n'est jamais écrasée. Et un livre supprimé en douceur
 * ressuscite (deleted_at remis à null).
 */
type Tables = Database["public"]["Tables"];
type MergeableFields = Pick<
  Tables["books"]["Row"],
  "series_name" | "issue_number" | "authors" | "publisher" | "page_count" | "isbn" | "cover_url"
>;
type BookUpdatePayload = MergeableFields & {
  deleted_at: null;
  title: string;
  category: BookInput["category"];
};

export function mergeBookFieldsOnRescan(existing: MergeableFields, input: BookInput): BookUpdatePayload {
  return {
    deleted_at: null, // un livre supprimé en douceur ressuscite au rescan
    title: input.title.trim(),
    category: input.category,
    // Comblement des NULL uniquement — jamais d'écrasement d'une valeur existante.
    series_name: existing.series_name ?? input.seriesName,
    issue_number: existing.issue_number ?? input.issueNumber,
    authors: existing.authors ?? input.authors,
    publisher: existing.publisher ?? input.publisher,
    page_count: existing.page_count ?? input.pageCount,
    isbn: existing.isbn ?? input.isbn,
    cover_url: existing.cover_url ?? input.coverUrl,
  };
}
