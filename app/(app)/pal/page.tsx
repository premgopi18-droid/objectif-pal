import { PalView } from "@/components/pal/pal-view";
import { PageLoadError } from "@/components/page-load-error";
import { derivePal } from "@/lib/pal/derive-pal";
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
      // `purchases!inner` : seuls les livres POSSÉDÉS remontent (issue #32,
      // lot B) — derivePal jetait de toute façon les emprunts (jamais dans la
      // pile, §4.5), on ne les transfère plus. Combiné au filtre deleted_at
      // sur l'embed, un livre dont tous les achats sont annulés est exclu dès
      // la requête, exactement comme derivePal l'aurait exclu.
      `id, title, series_name, issue_number, category, cover_url, deleted_at,
       purchases!inner (id, purchased_at, deleted_at),
       readings (status, finished_at, deleted_at)`,
    )
    .is("deleted_at", null)
    // Les filtres sur les embeds élaguent les lignes supprimées en douceur dès
    // la requête — derivePal refiltre de toute façon (défense en profondeur).
    .is("purchases.deleted_at", null)
    .is("readings.deleted_at", null);

  if (error) {
    return <PageLoadError title="Ma PAL" message="Impossible de charger la pile — réessaie." />;
  }

  const { entries, purchaseDates, ownedFinishedDates } = derivePal(data ?? []);

  return (
    <section className="py-6">
      <h1 className="text-2xl font-bold">Ma PAL</h1>
      <PalView entries={entries} purchaseDates={purchaseDates} ownedFinishedDates={ownedFinishedDates} />
    </section>
  );
}
