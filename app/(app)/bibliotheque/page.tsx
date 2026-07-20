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
        // `authors`, `publisher` et `page_count` ne s'affichent pas dans la
        // liste : ils alimentent le formulaire d'édition (#100), qui doit
        // ouvrir déjà rempli sans une requête de plus par livre.
        `id, title, series_name, issue_number, category, cover_url, created_at,
         authors, publisher, page_count, barcode_raw,
         readings (status, finished_at, deleted_at),
         purchases (purchased_at, deleted_at),
         ownerships (owned_since, disposed_at, deleted_at)`,
      )
      .is("deleted_at", null)
      // Les embeds supprimés en douceur sont élagués dès la requête —
      // deriveLibrary refiltre de toute façon (défense en profondeur).
      .is("readings.deleted_at", null)
      .is("purchases.deleted_at", null)
      .is("ownerships.deleted_at", null);

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
      // La jointure sur `purchases` était `!inner` (issue #32, lot B) : seuls
      // les livres achetés remontaient, puisqu'eux seuls pouvaient être en
      // pile. Depuis #101, un livre peut être POSSÉDÉ sans achat — l'inner
      // join l'aurait rendu invisible. On charge donc large et on laisse
      // `derivePal` trancher, comme avant #32.
      // Compromis assumé : on transfère aussi les emprunts (livres seulement
      // lus), que la dérivation jette. À l'échelle actuelle (une bibliothèque
      // personnelle) c'est sans effet ; la pagination #32 lot C reprendra le
      // sujet, et c'est là qu'un filtre serveur « possédé » aura sa place.
      `id, title, series_name, issue_number, category, cover_url, deleted_at,
       purchases (id, purchased_at, deleted_at),
       readings (status, finished_at, deleted_at),
       ownerships (id, owned_since, disposed_at, deleted_at)`,
    )
    .is("deleted_at", null)
    // Les filtres sur les embeds élaguent les lignes supprimées en douceur dès
    // la requête — derivePal refiltre de toute façon (défense en profondeur).
    .is("purchases.deleted_at", null)
    .is("readings.deleted_at", null)
    .is("ownerships.deleted_at", null);

  if (error) {
    return <PageLoadError title="Bibliothèque" message="Impossible de charger la pile — réessaie." />;
  }

  const { entries, entryDates, exitDates, undatedEntryCount, undatedExitCount } = derivePal(data ?? []);

  return (
    <section className="py-6">
      <h1 className="text-2xl font-bold">Bibliothèque</h1>
      <div className="mt-4">{segments}</div>
      <PalView
        entries={entries}
        entryDates={entryDates}
        exitDates={exitDates}
        undatedEntryCount={undatedEntryCount}
        undatedExitCount={undatedExitCount}
      />
    </section>
  );
}
