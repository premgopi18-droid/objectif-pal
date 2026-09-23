import { after } from "next/server";
import { MonthlyReportView } from "@/components/bilan/monthly-report-view";
import type { BilanReading, MonthlyPickRecord } from "@/components/bilan/monthly-report-view";
import { PageLoadError } from "@/components/page-load-error";
import { StatsView } from "@/components/stats/stats-view";
import { SegmentNav } from "@/components/ui/segment-nav";
import { readFactVersion, syncMonthlyReports } from "@/lib/bilan/report-sync";
import { fetchReadingEventFacts } from "@/lib/stats/reading-events";
import { fetchAllRows } from "@/lib/supabase/pagination";
import { summarizeSeries } from "@/lib/series/derive-series";
import { loadSeriesProgress } from "@/lib/series/queries";
import type { StatBookRecord } from "@/lib/stats/compute-stats";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { MonthlyObjective, PurchaseFact } from "@/lib/scoring/types";

/**
 * Le Bilan — deux volets portés par `?vue=` (design-specs §3) :
 *   - `bilan` (défaut) : le livrable mensuel au barème, copiable pour l'antenne
 *     (§4.5) — l'écran principal ;
 *   - `stats` : les statistiques essentielles (§1, §4.5), courbe de PAL comprise.
 * Les deux vues sont DÉPLACÉES telles quelles depuis `/bilan` et `/stats`
 * (vague 2, refonte #64) ; leur rhabillage viendra en vague 3. On ne charge que
 * les données du volet demandé — bascule = navigation d'URL.
 */
const REPORT_VIEWS = [
  { value: "bilan", label: "Bilan" },
  { value: "stats", label: "Stats" },
] as const;

type ReportViewKey = (typeof REPORT_VIEWS)[number]["value"];

export default async function BilanPage({
  searchParams,
}: {
  searchParams: Promise<{ vue?: string }>;
}) {
  const { vue } = await searchParams;
  // Défaut « bilan » : le volet le plus fréquent (§3). Toute valeur inconnue y retombe.
  const view: ReportViewKey = vue === "stats" ? "stats" : "bilan";
  const supabase = await createServerSupabaseClient();

  // Le volet passe EN ENFANT du SegmentNav (#331 item 2) : c'est lui qui
  // l'atténue pendant la navigation vers le volet suivant.
  const withSegments = (panel: React.ReactNode) => (
    <div className="mt-4">
      <SegmentNav label="Bilan ou statistiques" options={REPORT_VIEWS} value={view}>
        {panel}
      </SegmentNav>
    </div>
  );

  if (view === "stats") {
    // Les stats essentielles. UNE requête grouped (embeds PostgREST, pas de
    // N+1) ; le calcul vit dans la fonction pure `computeStats`, appelée côté
    // client (le « mois courant » est une notion du fuseau de l'APPAREIL).
    // Le journal d'états part EN PARALLÈLE : il porte les abandons et reprises
    // du lot A (#30). Requête bornée (filtrée `user_id` + RLS, index de #27),
    // et son échec n'emporte pas la page — les stats restent lisibles sans lui.
    // L'identité vient de `getClaims()` (JWT vérifié localement, #125) : le
    // `getUser()` réseau qui précédait mettait ~100 ms d'auth en amont du
    // journal d'états, en série (fluidité #331, item 7).
    const { data: statsClaims } = await supabase.auth.getClaims();
    const statsUserId = statsClaims?.claims.sub;
    const [{ data, error }, readingEvents, loadedSeries] = await Promise.all([
      supabase
        .from("books")
        .select(
          `id, title, category, publisher, series_name, page_count, deleted_at,
         purchases (purchased_at, deleted_at),
         readings (status, started_at, finished_at, rating, deleted_at),
         ownerships (owned_since, disposed_at, deleted_at)`,
        )
        .is("deleted_at", null)
        // Les filtres sur les embeds élaguent dès la requête — le moteur refiltre
        // de toute façon (défense en profondeur, même patron que la PAL).
        .is("purchases.deleted_at", null)
        .is("readings.deleted_at", null)
        .is("ownerships.deleted_at", null),
      statsUserId === undefined ? Promise.resolve(null) : fetchReadingEventFacts(supabase, statsUserId),
      // La moisson du suivi de séries (§4.17, lot C) — même dérivation que le
      // segment Séries, sans pseudos ni indice GCD ; en parallèle, son échec
      // n'emporte pas la page (review #297).
      loadSeriesProgress(supabase),
    ]);

    if (error) {
      return <PageLoadError title="Bilan du mois" message="Impossible de charger les statistiques — réessaie." />;
    }

    // Rows → contrat camelCase du moteur (types dérivés des Rows générés).
    const records: StatBookRecord[] = (data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
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
      // La possession déclarée (#101) : sans elle, la PAL des stats ignorerait
      // les livres possédés sans achat et divergerait du volet Pile (§4.5).
      ownerships: (row.ownerships ?? []).map((ownership) => ({
        ownedSince: ownership.owned_since,
        disposedAt: ownership.disposed_at,
        deletedAt: ownership.deleted_at,
      })),
    }));

    if ("error" in loadedSeries) console.error("[bilan] séries:", loadedSeries.error);
    const seriesSummary =
      "error" in loadedSeries
        ? null
        : { summary: summarizeSeries(loadedSeries.progress), seriesCount: loadedSeries.progress.length };

    return (
      <section className="py-6">
        <h1 className="text-2xl font-bold">Bilan du mois</h1>
        {withSegments(<StatsView records={records} readingEvents={readingEvents ?? []} seriesSummary={seriesSummary} />)}
      </section>
    );
  }

  // Volet Bilan (le livrable mensuel au barème). On charge TOUS les faits une
  // fois (contrat du moteur : les lectures terminées de tous les mois, pour
  // l'annulation du malus) et la navigation entre les mois se fait côté client,
  // sans re-requête — le score est toujours dérivé, jamais stocké (§4.7).
  // Les objectifs (§4.11) et distinctions (§4.4) suivent le même contrat.
  // La VERSION des faits se lit AVANT les faits (review #214) : si une édition
  // se glisse entre les deux, les agrégats seront tamponnés avec l'ancien
  // numéro et la prochaine visite recalculera — l'inverse rendrait l'erreur
  // permanente. `getClaims` : l'identité sans aller-retour réseau (#125).
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  const factVersion = userId ? await readFactVersion(supabase, userId) : null;

  // Les lectures et achats croissent sans borne : paginés (#178) — un compte
  // qui franchira 1 000 lignes ne verra jamais un bilan silencieusement faux.
  // UN SEUL étage (fluidité #331, item 7) : objectifs, distinctions, reveals
  // et profil partent AVEC les faits, dont ils ne dépendent pas — ils
  // attendaient derrière, un aller-retour de plus en série.
  let readingsRows;
  let purchasesRows;
  let objectivesResult;
  let picksResult;
  let revealsResult;
  let profileResult;
  try {
    [readingsRows, purchasesRows, objectivesResult, picksResult, revealsResult, profileResult] = await Promise.all([
      // L'inner join sur books élague les livres supprimés en douceur : sans lui,
      // les lectures/achats d'un livre effacé pèseraient au bilan tout en ayant
      // disparu de la PAL. book_id est NOT NULL → l'inner join ne perd rien.
      // `id` et `title` servent aux distinctions ; les métadonnées PUBLIQUES du
      // livre (#236 : couverture, série, auteurs, éditeur, pages, ISBN) partent
      // dans la ligne d'agrégat — c'est ce qu'un ami voit d'une terminée.
      fetchAllRows(async (from, to) => {
        const { data, error } = await supabase
          .from("readings")
          .select(
            "id, book_id, status, started_at, finished_at, book:books!inner (title, category, deleted_at, cover_url, series_name, authors, publisher, page_count, isbn)",
          )
          .eq("status", "finished")
          .is("deleted_at", null)
          .is("book.deleted_at", null)
          .order("id", { ascending: true })
          .range(from, to);
        if (error) throw new Error(error.message);
        return data ?? [];
      }),
      fetchAllRows(async (from, to) => {
        const { data, error } = await supabase
          .from("purchases")
          .select("id, book_id, purchased_at, book:books!inner (deleted_at)")
          .is("deleted_at", null)
          .is("book.deleted_at", null)
          .order("id", { ascending: true })
          .range(from, to);
        if (error) throw new Error(error.message);
        return data ?? [];
      }),
      supabase.from("monthly_objectives").select("month, objective_targets (category, target_count)"),
      supabase.from("monthly_picks").select("month, kind, reading_id, comment"),
      // Le reveal au cercle (#243) : mes reveals manuels + suis-je entré au
      // cercle (sans cercle, la section reveal n'a rien à raconter).
      supabase.from("monthly_reveals").select("month"),
      userId
        ? supabase.from("profiles").select("circle_joined_at, display_name, avatar_url").eq("id", userId).single()
        : Promise.resolve({ data: null, error: null }),
    ]);
  } catch {
    return <PageLoadError title="Bilan du mois" message="Impossible de charger le bilan — réessaie." />;
  }

  if (objectivesResult.error || picksResult.error) {
    return <PageLoadError title="Bilan du mois" message="Impossible de charger le bilan — réessaie." />;
  }
  // Un échec sur les reveals ne bloque pas le bilan (la section s'affichera au
  // prochain chargement) — le livrable d'antenne passe d'abord.
  const revealedMonths = (revealsResult.data ?? []).map((row) => row.month.slice(0, 7));
  const inCircle = profileResult.data?.circle_joined_at != null;
  // La carte de partage (§4.15) dessine le pseudo et la photo — les mêmes que
  // le Profil et le cercle affichent.
  const displayName = profileResult.data?.display_name ?? "Paliste";
  const avatarUrl = profileResult.data?.avatar_url ?? null;

  // L'embed `book` est inféré objet (FK many-to-one) : plus de tableau à déplier.
  const readings: BilanReading[] = (readingsRows ?? []).map((row) => ({
    readingId: row.id,
    title: row.book.title,
    bookId: row.book_id,
    category: row.book.category,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    book: {
      coverUrl: row.book.cover_url,
      seriesName: row.book.series_name,
      authors: row.book.authors,
      publisher: row.book.publisher,
      pageCount: row.book.page_count,
      isbn: row.book.isbn,
    },
  }));

  const purchases: PurchaseFact[] = (purchasesRows ?? []).map((row) => ({
    bookId: row.book_id,
    purchasedAt: row.purchased_at,
  }));

  // En base un mois est un `date` au 1er — le moteur parle en `YYYY-MM`.
  const objectivesByMonth: Record<string, MonthlyObjective> = Object.fromEntries(
    (objectivesResult.data ?? []).map((row) => [
      row.month.slice(0, 7),
      Object.fromEntries(row.objective_targets.map((target) => [target.category, target.target_count])),
    ]),
  );

  const picks: MonthlyPickRecord[] = (picksResult.data ?? []).map((row) => ({
    month: row.month.slice(0, 7),
    kind: row.kind,
    readingId: row.reading_id,
    comment: row.comment,
  }));

  // L'entretien des agrégats de mois clos (epic #182 — le socle de §4.14) :
  // les faits sont déjà en main, la synchro ne recalcule que si leur version
  // (lue AVANT les faits, cf. plus haut) a bougé, et n'est JAMAIS bloquante
  // — ni pour la correction (elle avale ses erreurs, le bilan affiché reste le
  // calcul en direct), ni pour la LATENCE (fluidité #331, item 7) : `after()`
  // l'exécute une fois la réponse envoyée. Avant, l'`await` mettait jusqu'à
  // trois allers-retours d'ÉCRITURE (select, upsert, delete) devant le rendu
  // d'une page de lecture. Le « mois courant » est celui du serveur (UTC) — à
  // la frontière du mois, un mois peut se clore jusqu'à 2 h avant l'heure de
  // Paris : sans enjeu pour un cache que la prochaine visite rafraîchit.
  if (userId && factVersion !== null) {
    const currentMonth = new Date().toISOString().slice(0, 7);
    after(() => syncMonthlyReports(supabase, userId, currentMonth, factVersion, { readings, purchases, objectivesByMonth }));
  }

  return (
    <section className="py-6">
      <h1 className="text-2xl font-bold">Bilan du mois</h1>
      {withSegments(
        <MonthlyReportView
          readings={readings}
          purchases={purchases}
          objectivesByMonth={objectivesByMonth}
          picks={picks}
          revealedMonths={revealedMonths}
          inCircle={inCircle}
          displayName={displayName}
          avatarUrl={avatarUrl}
        />,
      )}
    </section>
  );
}
