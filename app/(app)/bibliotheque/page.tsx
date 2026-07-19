import { LibraryView } from "@/components/library/library-view";
import { PageLoadError } from "@/components/page-load-error";
import { PalView } from "@/components/pal/pal-view";
import { SegmentNav } from "@/components/ui/segment-nav";
import { deriveLibrary } from "@/lib/library/derive-library";
import { derivePal } from "@/lib/pal/derive-pal";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * La Bibliothèque — deux volets portés par `?vue=` (design-specs §3) :
 *   - `pile` (défaut) : la PAL, « ce que je possède et n'ai pas lu » (§4.6) ;
 *   - `tous` : TOUS les livres possédés (issue #49), même sans lecture ni achat
 *     actif — l'angle mort des projections.
 * Les deux vues sont DÉPLACÉES telles quelles depuis `/pal` et l'ancienne
 * Bibliothèque (vague 2, refonte #64) ; leur rhabillage viendra en vague 3. On
 * ne charge que les données du volet demandé — bascule = navigation d'URL.
 */
const LIBRARY_VIEWS = [
  { value: "pile", label: "Pile (PAL)" },
  { value: "tous", label: "Tous" },
] as const;

type LibraryViewKey = (typeof LIBRARY_VIEWS)[number]["value"];

export default async function BibliothequePage({
  searchParams,
}: {
  searchParams: Promise<{ vue?: string }>;
}) {
  const { vue } = await searchParams;
  // Défaut « pile » : le volet le plus fréquent (§3). Toute valeur inconnue y retombe.
  const view: LibraryViewKey = vue === "tous" ? "tous" : "pile";
  const supabase = await createServerSupabaseClient();

  const segments = <SegmentNav label="Vue de la bibliothèque" options={LIBRARY_VIEWS} value={view} />;

  if (view === "tous") {
    // TOUS les livres. Lu avec le client SESSION : la RLS ne montre que les
    // livres de l'utilisateur.
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
        <div className="mt-4">{segments}</div>
        <LibraryView entries={entries} />
      </section>
    );
  }

  // Volet Pile (l'ancienne PAL). Toute la sémantique de pile (entrées, sorties,
  // rachats de déjà-lus) vit dans la fonction pure `derivePal`, testée.
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
    return <PageLoadError title="Bibliothèque" message="Impossible de charger la pile — réessaie." />;
  }

  const { entries, purchaseDates, ownedFinishedDates } = derivePal(data ?? []);

  return (
    <section className="py-6">
      <h1 className="text-2xl font-bold">Bibliothèque</h1>
      <div className="mt-4">{segments}</div>
      <PalView entries={entries} purchaseDates={purchaseDates} ownedFinishedDates={ownedFinishedDates} />
    </section>
  );
}
