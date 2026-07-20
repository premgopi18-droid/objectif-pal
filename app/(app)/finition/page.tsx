import { FinitionView } from "@/components/finition/finition-view";
import { PageLoadError } from "@/components/page-load-error";
import { sortByCompletionEffort, type ScanInboxItem } from "@/lib/books/scan-inbox";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * La boîte de finition (#101 lot C, specs §4.13) — ce que la rafale a capté
 * sans pouvoir l'identifier. Lue avec le client SESSION : la RLS ne montre que
 * les éléments de l'utilisateur.
 *
 * L'ordre vient de la fonction pure `sortByCompletionEffort` : les éléments
 * déjà à moitié identifiés d'abord, pour que la boîte se vide vite.
 */
export default async function FinitionPage() {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("scan_inbox")
    .select("id, barcode_raw, barcode_type, cover_url, resolved_metadata, intent, owned_since, finished_at, created_at")
    .eq("status", "pending")
    .is("deleted_at", null);

  if (error) {
    return <PageLoadError title="À compléter" message="Impossible de charger la boîte de finition — réessaie." />;
  }

  const items = sortByCompletionEffort((data ?? []) as ScanInboxItem[]);

  return (
    <section className="py-6">
      <h1 className="text-2xl font-bold">À compléter</h1>
      <FinitionView items={items} />
    </section>
  );
}
