import { PageLoadError } from "@/components/page-load-error";
import { StatsView } from "@/components/stats/stats-view";
import type { StatBookRecord } from "@/lib/stats/compute-stats";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Les stats essentielles — la partie « en tirer des statistiques » de
 * l'objectif principal (specs §1, §4.5). La page ne fait que charger : UNE
 * requête grouped (embeds PostgREST, pas de N+1), le calcul vit dans la
 * fonction pure `computeStats` — appelée côté client, car le « mois courant »
 * est une notion du fuseau de l'APPAREIL, comme au bilan.
 */
export default async function StatsPage() {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("books")
    .select(
      `id, category, publisher, series_name, page_count, deleted_at,
       purchases (purchased_at, deleted_at),
       readings (status, started_at, finished_at, rating, deleted_at)`,
    )
    .is("deleted_at", null)
    // Les filtres sur les embeds élaguent dès la requête — le moteur refiltre
    // de toute façon (défense en profondeur, même patron que la PAL).
    .is("purchases.deleted_at", null)
    .is("readings.deleted_at", null);

  if (error) {
    return <PageLoadError title="Stats" message="Impossible de charger les statistiques — réessaie." />;
  }

  // Rows → contrat camelCase du moteur (types dérivés des Rows générés).
  const records: StatBookRecord[] = (data ?? []).map((row) => ({
    id: row.id,
    category: row.category,
    publisher: row.publisher,
    seriesName: row.series_name,
    pageCount: row.page_count,
    deletedAt: row.deleted_at,
    purchases: (row.purchases ?? []).map((purchase) => ({
      purchasedAt: purchase.purchased_at,
      deletedAt: purchase.deleted_at,
    })),
    readings: (row.readings ?? []).map((reading) => ({
      status: reading.status,
      startedAt: reading.started_at,
      finishedAt: reading.finished_at,
      rating: reading.rating,
      deletedAt: reading.deleted_at,
    })),
  }));

  return (
    <section className="py-6">
      <h1 className="text-2xl font-bold">Stats</h1>
      <StatsView records={records} />
    </section>
  );
}
