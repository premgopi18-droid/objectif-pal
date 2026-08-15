import { JournalList, type JournalEntry } from "@/components/journal/journal-list";
import {
  JOURNAL_PAGE_SIZE,
  parseJournalDepth,
  parseJournalFilters,
  parseJournalSearch,
  parseJournalSort,
} from "@/components/journal/journal-url";
import { PageLoadError } from "@/components/page-load-error";
import { escapeIlikePattern, normalizeForSearch } from "@/lib/search/entry-search";
import { fetchAllRows } from "@/lib/supabase/pagination";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Le journal — specs §4.2 : tout ce que je lis et ai lu, avec les états, les
 * dates, et le geste qui rapporte les points (« Terminé », un tap). Lu avec le
 * client SESSION : la RLS ne montre que les lectures de l'utilisateur.
 *
 * PAGINÉ (#32 lot C) : filtres et profondeur vivent dans les searchParams —
 * la requête ne rapporte que la tranche affichée, dans l'ordre CONTRACTUEL de
 * la vue `journal_entries` (#146 : l'activité d'abord, figé en SQL — c'est ce
 * qui permet à « Charger plus » de prolonger l'ordre au lieu de l'entremêler).
 * Les gestes continuent de rafraîchir par revalidation : la liste reste une
 * prop du serveur, aucune copie d'état côté client.
 */
export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createServerSupabaseClient();
  const params = await searchParams;
  const filters = parseJournalFilters(params);
  const depth = parseJournalDepth(params);
  const sort = parseJournalSort(params);
  const search = parseJournalSearch(params);

  let query = supabase
    .from("journal_entries")
    .select(
      "id, status, started_at, finished_at, rating, comment, book_id, title, series_name, issue_number, category, cover_url, page_count",
      { count: "exact" },
    );
  if (filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.category !== "all") query = query.eq("category", filters.category);
  if (filters.seriesName !== "all") query = query.eq("series_name", filters.seriesName);
  if (filters.month !== "all") query = query.eq("journal_month", filters.month);
  // La recherche (#222) — côté SQL, la seule qui fouille TOUT le journal
  // paginé : l'aiguille est normalisée par la MÊME règle que `search_text`
  // (parité TS/unaccent, lib/search) et échappée (`%_\` sont des jokers).
  if (search !== "") query = query.ilike("search_text", `%${escapeIlikePattern(normalizeForSearch(search))}%`);

  // Le tri (#217) : « activite » est l'ordre contractuel #146 ; les autres
  // sont des vues alternatives — sans-date et sans-note relégués en bas
  // (nullsFirst: false), id en départage final pour un ordre total (la
  // condition de « Charger plus »).
  const ordered = (() => {
    switch (sort) {
      case "lecture":
        return query.order("journal_date", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });
      case "note":
        return query
          .order("rating", { ascending: false, nullsFirst: false })
          .order("journal_date", { ascending: false, nullsFirst: false });
      case "ajout":
        return query.order("created_at", { ascending: false });
      case "ajout-ancien":
        return query.order("created_at", { ascending: true });
      case "titre":
        return query.order("title", { ascending: true });
      case "titre-inverse":
        return query.order("title", { ascending: false });
      default: // « activite » — l'ordre #146, celui des séparateurs de mois
        return query
          .order("journal_rank", { ascending: true })
          .order("journal_date", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false });
    }
  })();

  // depth + 1 : la ligne de trop dit s'il reste quelque chose à charger.
  const [entriesResult, optionsResult] = await Promise.all([
    ordered.order("id", { ascending: true }).range(0, depth),
    // Les options des selects (séries, mois) se dérivent du journal ENTIER,
    // pas de la tranche : 2 colonnes par lecture, paginé anti-troncature
    // (#178) — quelques Ko, pas quelques centaines.
    fetchAllRows(async (from, to) => {
      const { data, error } = await supabase
        .from("journal_entries")
        .select("series_name, journal_month")
        .range(from, to);
      if (error) throw new Error(error.message);
      return data ?? [];
    }).catch(() => null),
  ]);

  const { data, error, count } = entriesResult;
  if (error) {
    return <PageLoadError title="Journal" message="Impossible de charger le journal — réessaie." />;
  }

  const rows = data ?? [];
  const hasMore = rows.length > depth;
  // La frontière snake_case → camelCase : la seule couche qui voit les noms
  // de colonnes de la vue.
  const entries: JournalEntry[] = rows.slice(0, depth).map((row) => ({
    id: row.id as string,
    status: row.status as JournalEntry["status"],
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    rating: row.rating === null ? null : Number(row.rating),
    comment: row.comment,
    book: {
      bookId: row.book_id as string,
      title: row.title as string,
      seriesName: row.series_name,
      issueNumber: row.issue_number,
      category: row.category as JournalEntry["book"]["category"],
      coverUrl: row.cover_url,
      pageCount: row.page_count,
    },
  }));

  const seriesOptions = [
    ...new Set((optionsResult ?? []).map((row) => row.series_name).filter((name): name is string => name !== null)),
  ].sort((left, right) => left.localeCompare(right));
  const monthOptions = [
    ...new Set((optionsResult ?? []).map((row) => row.journal_month).filter((month): month is string => month !== null)),
  ]
    .sort()
    .reverse();

  return (
    <section className="py-6">
      <h1 className="text-2xl font-bold">Journal</h1>
      <JournalList
        entries={entries}
        filters={filters}
        sort={sort}
        search={search}
        totalCount={count ?? entries.length}
        hasMore={hasMore}
        depth={depth}
        seriesOptions={seriesOptions}
        monthOptions={monthOptions}
      />
    </section>
  );
}
