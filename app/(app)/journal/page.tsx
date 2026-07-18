import { JournalList, type JournalEntry } from "@/components/journal/journal-list";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Le journal — specs §4.2 : tout ce que je lis et ai lu, avec les états, les
 * dates, et le geste qui rapporte les points (« Terminé », un tap). Lu avec le
 * client SESSION : la RLS ne montre que les lectures de l'utilisateur.
 */
export default async function JournalPage() {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("readings")
    .select(
      `id, status, started_at, finished_at, rating, comment,
       book:books (title, series_name, issue_number, category, cover_url, page_count)`,
    )
    .is("deleted_at", null)
    .order("started_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <section className="py-6">
        <h1 className="text-2xl font-bold">Journal</h1>
        <p role="alert" className="mt-3 text-sm text-red-500">
          Impossible de charger le journal — réessaie.
        </p>
      </section>
    );
  }

  // La frontière snake_case → camelCase : la seule couche qui voit les noms
  // de colonnes (l'embed `book` est inféré objet — la FK est many-to-one).
  const entries: JournalEntry[] = (data ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    rating: row.rating === null ? null : Number(row.rating),
    comment: row.comment,
    book: {
      title: row.book.title,
      seriesName: row.book.series_name,
      issueNumber: row.book.issue_number,
      category: row.book.category,
      coverUrl: row.book.cover_url,
      pageCount: row.book.page_count,
    },
  }));

  return (
    <section className="py-6">
      <h1 className="text-2xl font-bold">Journal</h1>
      <JournalList entries={entries} />
    </section>
  );
}
