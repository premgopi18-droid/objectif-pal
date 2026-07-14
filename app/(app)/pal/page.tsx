import { PalView, type PalEntry } from "@/components/pal/pal-view";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * La PAL — « ce que je possède et que je n'ai pas lu » (la précaution de
 * vocabulaire des specs §1 : aujourd'hui la possession se lit dans les achats,
 * demain la source s'élargira sans changer la définition). Un livre en sort en
 * étant TERMINÉ — jamais en étant commencé (specs §4.6).
 */
export default async function PalPage() {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("books")
    .select(
      `id, title, series_name, issue_number, category, cover_url,
       purchases (purchased_at, deleted_at),
       readings (status, finished_at, deleted_at)`,
    )
    .is("deleted_at", null);

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

  const entries: PalEntry[] = [];
  const purchaseDates: string[] = [];
  const ownedFinishedDates: string[] = [];

  for (const book of data ?? []) {
    const purchases = (book.purchases ?? []).filter((purchase) => purchase.deleted_at === null);
    const readings = (book.readings ?? []).filter((reading) => reading.deleted_at === null);
    const isOwned = purchases.length > 0;
    if (!isOwned) continue;

    purchaseDates.push(...purchases.map((purchase) => purchase.purchased_at));

    // UNE sortie de pile par livre : sa PREMIÈRE fin de lecture. Les relectures
    // re-rapportent leurs points (§4.2) mais ne re-vident pas la pile — sinon
    // la courbe de PAL fondrait artificiellement (§4.5, review #19).
    const firstFinishedDate = readings
      .filter((reading) => reading.status === "finished" && reading.finished_at !== null)
      .map((reading) => reading.finished_at as string)
      .sort()[0];
    if (firstFinishedDate) ownedFinishedDates.push(firstFinishedDate);

    const isFinished = readings.some((reading) => reading.status === "finished");
    if (isFinished) continue; // sorti de la pile — l'achat, lui, reste dans l'historique

    entries.push({
      bookId: book.id,
      title: book.title,
      seriesName: book.series_name,
      issueNumber: book.issue_number,
      category: book.category,
      coverUrl: book.cover_url,
      // Le plus ancien achat date l'entrée dans la pile.
      purchasedAt: purchases.map((purchase) => purchase.purchased_at).sort()[0],
      isInProgress: readings.some((reading) => reading.status === "reading"),
    });
  }

  entries.sort((left, right) => left.purchasedAt.localeCompare(right.purchasedAt));

  return (
    <section className="py-6">
      <h1 className="text-2xl font-bold">Ma PAL</h1>
      <PalView entries={entries} purchaseDates={purchaseDates} ownedFinishedDates={ownedFinishedDates} />
    </section>
  );
}
