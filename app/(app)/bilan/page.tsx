import { MonthlyReportView } from "@/components/bilan/monthly-report-view";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { PurchaseFact, ReadingFact } from "@/lib/scoring/types";

/**
 * Le bilan mensuel au barème — l'écran principal, LE livrable (specs §4.5) :
 * exactement ce qu'on lit à l'antenne. On charge TOUS les faits une fois
 * (contrat du moteur : les lectures terminées de tous les mois, pour
 * l'annulation du malus) et la navigation entre les mois se fait côté client,
 * sans re-requête — le score est toujours dérivé, jamais stocké (§4.7).
 */
export default async function BilanPage() {
  const supabase = await createServerSupabaseClient();

  const [readingsResult, purchasesResult] = await Promise.all([
    supabase
      .from("readings")
      .select("book_id, status, started_at, finished_at, book:books (category)")
      .eq("status", "finished")
      .is("deleted_at", null),
    supabase.from("purchases").select("book_id, purchased_at").is("deleted_at", null),
  ]);

  if (readingsResult.error || purchasesResult.error) {
    return (
      <section className="py-6">
        <h1 className="text-2xl font-bold">Bilan du mois</h1>
        <p role="alert" className="mt-3 text-sm text-red-500">
          Impossible de charger le bilan — réessaie.
        </p>
      </section>
    );
  }

  const readings: ReadingFact[] = (readingsResult.data ?? []).map((row) => {
    const book = Array.isArray(row.book) ? row.book[0] : row.book;
    return {
      bookId: row.book_id,
      category: book.category,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    };
  });

  const purchases: PurchaseFact[] = (purchasesResult.data ?? []).map((row) => ({
    bookId: row.book_id,
    purchasedAt: row.purchased_at,
  }));

  return (
    <section className="py-6">
      <h1 className="text-2xl font-bold">Bilan du mois</h1>
      <MonthlyReportView readings={readings} purchases={purchases} />
    </section>
  );
}
