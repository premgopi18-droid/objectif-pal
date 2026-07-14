import { PalView } from "@/components/pal/pal-view";
import { derivePal, type PalBookRecord } from "@/lib/pal/derive-pal";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * La PAL — « ce que je possède et que je n'ai pas lu » (la précaution de
 * vocabulaire des specs §1 : aujourd'hui la possession se lit dans les achats,
 * demain la source s'élargira sans changer la définition). Un livre en sort en
 * étant TERMINÉ — jamais en étant commencé (specs §4.6).
 *
 * La page ne fait que charger : toute la sémantique de pile (entrées, sorties,
 * rachats de déjà-lus) vit dans la fonction pure `derivePal`, testée.
 */
export default async function PalPage() {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("books")
    .select(
      `id, title, series_name, issue_number, category, cover_url, deleted_at,
       purchases (purchased_at, deleted_at),
       readings (status, finished_at, deleted_at)`,
    )
    .is("deleted_at", null)
    // Les filtres sur les embeds élaguent les lignes supprimées en douceur dès
    // la requête — derivePal refiltre de toute façon (défense en profondeur).
    .is("purchases.deleted_at", null)
    .is("readings.deleted_at", null);

  if (error) {
    return (
      <section className="py-6">
        <h1 className="text-2xl font-bold">Ma PAL</h1>
        <p role="alert" className="mt-3 text-sm text-red-500">
          Impossible de charger la pile — réessaie.
        </p>
      </section>
    );
  }

  const { entries, purchaseDates, ownedFinishedDates } = derivePal((data ?? []) as PalBookRecord[]);

  return (
    <section className="py-6">
      <h1 className="text-2xl font-bold">Ma PAL</h1>
      <PalView entries={entries} purchaseDates={purchaseDates} ownedFinishedDates={ownedFinishedDates} />
    </section>
  );
}
