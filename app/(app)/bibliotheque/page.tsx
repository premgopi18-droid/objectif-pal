import { LibraryView } from "@/components/library/library-view";
import { PageLoadError } from "@/components/page-load-error";
import { deriveLibrary } from "@/lib/library/derive-library";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * La Bibliothèque — TOUS les livres (issue #49), y compris ceux sans lecture
 * ni achat actifs, invisibles du journal et de la PAL (l'angle mort des
 * projections). Lu avec le client SESSION : la RLS ne montre que les livres
 * de l'utilisateur.
 */
export default async function BibliothequePage() {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("books")
    .select(
      `id, title, series_name, issue_number, category, cover_url, created_at,
       readings (status, deleted_at),
       purchases (deleted_at)`,
    )
    .is("deleted_at", null)
    // Les embeds supprimés en douceur sont élagués dès la requête —
    // deriveLibrary refiltre de toute façon (défense en profondeur).
    .is("readings.deleted_at", null)
    .is("purchases.deleted_at", null);

  if (error) {
    return <PageLoadError title="Bibliothèque" message="Impossible de charger la bibliothèque — réessaie." />;
  }

  const entries = deriveLibrary(data ?? []);

  return (
    <section className="py-6">
      <h1 className="text-2xl font-bold">Bibliothèque</h1>
      <LibraryView entries={entries} />
    </section>
  );
}
