import { createHash } from "node:crypto";
import { unstable_cache } from "next/cache";
import { MonthlyReportView } from "@/components/bilan/monthly-report-view";
import type { BilanReading, MonthlyPickRecord } from "@/components/bilan/monthly-report-view";
import { PageLoadError } from "@/components/page-load-error";
import { StatsView } from "@/components/stats/stats-view";
import { SegmentNav } from "@/components/ui/segment-nav";
import { syncMonthlyReports } from "@/lib/bilan/report-sync";
import { createGcdProvider } from "@/lib/resolution/providers/gcd";
import { fetchReadingEventFacts } from "@/lib/stats/reading-events";
import { fetchAllRows } from "@/lib/supabase/pagination";
import { fetchSeriesCatalog, toGcdIssueId, type SeriesCatalog } from "@/lib/stats/series-catalog";
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

  const segments = <SegmentNav label="Bilan ou statistiques" options={REPORT_VIEWS} value={view} />;

  if (view === "stats") {
    // Les stats essentielles. UNE requête grouped (embeds PostgREST, pas de
    // N+1) ; le calcul vit dans la fonction pure `computeStats`, appelée côté
    // client (le « mois courant » est une notion du fuseau de l'APPAREIL).
    // Le journal d'états part EN PARALLÈLE : il porte les abandons et reprises
    // du lot A (#30). Requête bornée (filtrée `user_id` + RLS, index de #27),
    // et son échec n'emporte pas la page — les stats restent lisibles sans lui.
    const [{ data, error }, sessionResult] = await Promise.all([
      supabase
        .from("books")
        .select(
          `id, title, category, publisher, series_name, page_count, deleted_at,
         metadata_source, metadata_source_id,
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
      supabase.auth.getUser(),
    ]);

    if (error) {
      return <PageLoadError title="Bilan du mois" message="Impossible de charger les statistiques — réessaie." />;
    }

    const userId = sessionResult.data.user?.id;
    const readingEvents = userId === undefined ? null : await fetchReadingEventFacts(supabase, userId);

    // Rows → contrat camelCase du moteur (types dérivés des Rows générés).
    const records: StatBookRecord[] = (data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      category: row.category,
      publisher: row.publisher,
      seriesName: row.series_name,
      gcdIssueId: toGcdIssueId(row.metadata_source, row.metadata_source_id),
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

    // Le catalogue GCD des séries commencées (#30, lot B) : la numérotation qui
    // permet d'annoncer le tome suivant. Requêtes BORNÉES (au plus 5, jamais une
    // par tome ni par série — cf. `fetchSeriesCatalog`) et lecture d'une table
    // de référence, donc via le client admin. Son échec n'emporte pas la page :
    // sans catalogue, la section « Séries en cours » se tait, le reste vit.
    // CACHÉ 24 h (epic #182, Phase 1) : les données GCD sont INDÉPENDANTES de
    // l'utilisateur et ne bougent qu'au dump bimensuel — le seul cache sans
    // aucun risque de fraîcheur de l'app. La clé porte les tomes lus : un
    // nouveau scan change la clé, le catalogue suit immédiatement ; seule la
    // numérotation GCD peut avoir jusqu'à un jour de retard, sans enjeu.
    let seriesCatalog: SeriesCatalog | undefined;
    try {
      const gcdIssueIds = [
        ...new Set(
          records
            .map((record) => record.gcdIssueId)
            .filter((gcdIssueId): gcdIssueId is number => gcdIssueId != null),
        ),
      ].sort((left, right) => left - right);
      // Clé hachée (review #204) : le join des ids peut approcher ~4 Ko à
      // 600 livres — le comportement d'unstable_cache avec des keyParts de
      // cette taille n'est pas contractuel.
      const catalogCacheKey = createHash("sha256").update(gcdIssueIds.join(",")).digest("hex");
      seriesCatalog = await unstable_cache(
        () => fetchSeriesCatalog(createGcdProvider(), gcdIssueIds),
        ["series-catalog", catalogCacheKey],
        { revalidate: 24 * 60 * 60 },
      )();
    } catch {
      seriesCatalog = undefined;
    }

    return (
      <section className="py-6">
        <h1 className="text-2xl font-bold">Bilan du mois</h1>
        <div className="mt-4">{segments}</div>
        <StatsView records={records} readingEvents={readingEvents ?? []} seriesCatalog={seriesCatalog} />
      </section>
    );
  }

  // Volet Bilan (le livrable mensuel au barème). On charge TOUS les faits une
  // fois (contrat du moteur : les lectures terminées de tous les mois, pour
  // l'annulation du malus) et la navigation entre les mois se fait côté client,
  // sans re-requête — le score est toujours dérivé, jamais stocké (§4.7).
  // Les objectifs (§4.11) et distinctions (§4.4) suivent le même contrat.
  // Les lectures et achats croissent sans borne : paginés (#178) — un compte
  // qui franchira 1 000 lignes ne verra jamais un bilan silencieusement faux.
  let readingsRows;
  let purchasesRows;
  try {
    [readingsRows, purchasesRows] = await Promise.all([
      // L'inner join sur books élague les livres supprimés en douceur : sans lui,
      // les lectures/achats d'un livre effacé pèseraient au bilan tout en ayant
      // disparu de la PAL. book_id est NOT NULL → l'inner join ne perd rien.
      // `id` et `title` servent aux distinctions (choisir une lecture du mois).
      fetchAllRows(async (from, to) => {
        const { data, error } = await supabase
          .from("readings")
          .select("id, book_id, status, started_at, finished_at, book:books!inner (title, category, deleted_at)")
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
    ]);
  } catch {
    return <PageLoadError title="Bilan du mois" message="Impossible de charger le bilan — réessaie." />;
  }

  const [objectivesResult, picksResult] = await Promise.all([
    supabase.from("monthly_objectives").select("month, objective_targets (category, target_count)"),
    supabase.from("monthly_picks").select("month, kind, reading_id, comment"),
  ]);

  if (objectivesResult.error || picksResult.error) {
    return <PageLoadError title="Bilan du mois" message="Impossible de charger le bilan — réessaie." />;
  }

  // L'embed `book` est inféré objet (FK many-to-one) : plus de tableau à déplier.
  const readings: BilanReading[] = (readingsRows ?? []).map((row) => ({
    readingId: row.id,
    title: row.book.title,
    bookId: row.book_id,
    category: row.book.category,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
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
  // les faits sont déjà en main, la synchro ne recalcule que si leur version a
  // bougé, et n'est JAMAIS bloquante (le bilan affiché reste le calcul en
  // direct). `getClaims` : l'identité sans aller-retour réseau (#125). Le
  // « mois courant » est celui du serveur (UTC) — à la frontière du mois, un
  // mois peut se clore jusqu'à 2 h avant l'heure de Paris : sans enjeu pour un
  // cache que la prochaine visite raffraîchit.
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (userId) {
    await syncMonthlyReports(supabase, userId, new Date().toISOString().slice(0, 7), {
      readings,
      purchases,
      objectivesByMonth,
    });
  }

  return (
    <section className="py-6">
      <h1 className="text-2xl font-bold">Bilan du mois</h1>
      <div className="mt-4">{segments}</div>
      <MonthlyReportView readings={readings} purchases={purchases} objectivesByMonth={objectivesByMonth} picks={picks} />
    </section>
  );
}
