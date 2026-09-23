import "server-only";

import { splitCircleLinks } from "@/lib/circle/friendship";
import {
  deriveSeries,
  nextInPileBookIds,
  type KnownMax,
  type SeriesBookFact,
  type SeriesFact,
  type SeriesProgress,
} from "@/lib/series/derive-series";
import { fetchSeriesFloors } from "@/lib/series/known-max";
import type { createServerSupabaseClient } from "@/lib/supabase/server";

type SessionSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

/** Ce que le segment « Séries » (lot B, §4.17) reçoit — dérivé côté serveur, une fois. */
export type SeriesSegmentData = {
  progress: SeriesProgress[];
  /**
   * Le libellé de l'auteur d'un fait, par `user_id` : « toi », ou le pseudo d'un
   * AMI accepté (règle de `get_cover_contributions` : le pseudo n'est servi
   * qu'au cercle). Absent = « un membre ».
   */
  declarerLabels: Record<string, string>;
  /** Les séries reliées à GCD — la bannière de fusion n'en propose jamais deux. */
  gcdLinkedSeriesIds: string[];
};

type LoadFailure = { error: string };

/**
 * La ligne `books` (+ embeds) dont la dérivation des séries a besoin. Les pages
 * qui chargent DÉJÀ les livres avec ces colonnes (Pile, Stats) la passent
 * telle quelle (fluidité #333, item 3) : avant, `loadSeriesProgress` relisait
 * toute la table `books` avec ses trois embeds — une seconde fois par render.
 */
export type SeriesBookRow = {
  id: string;
  title: string;
  series_id: string | null;
  category: SeriesBookFact["category"];
  issue_number: string | null;
  cover_url: string | null;
  publisher: string | null;
  purchases: { purchased_at: string; deleted_at: string | null }[] | null;
  readings: { status: SeriesBookFact["readings"][number]["status"]; finished_at: string | null; deleted_at: string | null }[] | null;
  ownerships: { owned_since: string | null; disposed_at: string | null; deleted_at: string | null }[] | null;
};

/** La sélection `books` qui produit une `SeriesBookRow` — à inclure dans les pages qui veulent partager leur lecture. */
export const SERIES_BOOK_SELECT = `id, title, series_id, category, issue_number, cover_url, publisher,
       purchases (purchased_at, deleted_at),
       readings (status, finished_at, deleted_at),
       ownerships (owned_since, disposed_at, deleted_at)`;

async function loadSeriesBookRows(supabase: SessionSupabaseClient): Promise<SeriesBookRow[] | LoadFailure> {
  const { data, error } = await supabase
    .from("books")
    .select(SERIES_BOOK_SELECT)
    .is("deleted_at", null)
    .not("series_id", "is", null)
    .is("purchases.deleted_at", null)
    .is("readings.deleted_at", null)
    .is("ownerships.deleted_at", null);
  if (error) return { error: error.message };
  return data ?? [];
}

const toSeriesBookFacts = (rows: SeriesBookRow[]): SeriesBookFact[] =>
  rows.flatMap((row) =>
    row.series_id === null
      ? []
      : [
          {
            id: row.id,
            seriesId: row.series_id,
            title: row.title,
            category: row.category,
            issueNumber: row.issue_number,
            coverUrl: row.cover_url,
            publisher: row.publisher,
            // Les embeds supprimés en douceur sont refiltrés ici (défense en
            // profondeur) : une page qui passe ses lignes a pu les charger sans filtre.
            purchases: (row.purchases ?? [])
              .filter((purchase) => purchase.deleted_at === null)
              .map((purchase) => ({ purchasedAt: purchase.purchased_at, deletedAt: purchase.deleted_at })),
            readings: (row.readings ?? [])
              .filter((reading) => reading.deleted_at === null)
              .map((reading) => ({ status: reading.status, finishedAt: reading.finished_at, deletedAt: reading.deleted_at })),
            ownerships: (row.ownerships ?? [])
              .filter((ownership) => ownership.deleted_at === null)
              .map((ownership) => ({
                ownedSince: ownership.owned_since,
                disposedAt: ownership.disposed_at,
                deletedAt: ownership.deleted_at,
              })),
          },
        ],
  );

/**
 * La progression de toutes les séries de l'utilisateur : ses livres reliés
 * (avec leurs faits — la règle de pile a besoin des dates), les séries du
 * référentiel qu'ils touchent, les planchers vivants (GCD, éditions BnF) si demandés. Requêtes
 * bornées par les séries de l'utilisateur, jamais une par série. Partagé par
 * le segment (lot B), les Stats et la roulette (lot C).
 *
 * `rows` : les livres déjà chargés par la page (fluidité #333, item 3) — sans
 * eux, la table est lue ici.
 */
export async function loadSeriesProgress(
  supabase: SessionSupabaseClient,
  options: { withKnownMax?: boolean; includeHidden?: boolean; rows?: SeriesBookRow[] } = {},
): Promise<{ progress: SeriesProgress[]; seriesIds: string[]; gcdLinkedSeriesIds: string[] } | LoadFailure> {
  const rows = options.rows ?? (await loadSeriesBookRows(supabase));
  if ("error" in rows) return rows;
  const books = toSeriesBookFacts(rows);
  const seriesIds = [...new Set(books.map((book) => book.seriesId))];
  if (seriesIds.length === 0) return { progress: [], seriesIds: [], gcdLinkedSeriesIds: [] };

  const [seriesResult, floors] = await Promise.all([
    supabase
      .from("series")
      .select(
        "id, name, category, total_volumes, is_ongoing, fact_declared_by, fact_declared_at, fact_source, human_total_volumes, human_is_ongoing, human_declared_by, human_declared_at, fact_locked_at, fact_confirmed_by",
      )
      .in("id", seriesIds),
    options.withKnownMax
      ? fetchSeriesFloors(supabase, seriesIds)
      : Promise.resolve({ knownMax: new Map<string, KnownMax[]>(), gcdLinkedSeriesIds: [] }),
  ]);
  if (seriesResult.error) return { error: seriesResult.error.message };

  const seriesList: SeriesFact[] = (seriesResult.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    totalVolumes: row.total_volumes,
    isOngoing: row.is_ongoing,
    factDeclaredBy: row.fact_declared_by,
    factDeclaredAt: row.fact_declared_at,
    factSource: row.fact_source === "gcd" || row.fact_source === "anilist" ? row.fact_source : "human",
    humanTotalVolumes: row.human_total_volumes,
    humanIsOngoing: row.human_is_ongoing,
    humanDeclaredBy: row.human_declared_by,
    humanDeclaredAt: row.human_declared_at,
    factLockedAt: row.fact_locked_at,
    factConfirmedBy: row.fact_confirmed_by === "gcd" || row.fact_confirmed_by === "anilist" ? row.fact_confirmed_by : null,
  }));
  return {
    progress: deriveSeries(seriesList, books, floors.knownMax, { includeHidden: options.includeHidden }),
    seriesIds,
    gcdLinkedSeriesIds: floors.gcdLinkedSeriesIds,
  };
}

/**
 * Le segment « Séries » : la progression + les pseudos du cercle + les liens
 * GCD (pour la bannière). Le cercle (amitiés, pseudos) ne dépend pas des
 * séries : il part EN PARALLÈLE de la progression (fluidité #333, item 2) ; les
 * liens GCD viennent de la même lecture que les planchers, plus d'une seconde
 * requête sur `series_external_ids`.
 */
export async function loadSeriesSegment(supabase: SessionSupabaseClient, userId: string): Promise<SeriesSegmentData | LoadFailure> {
  // Compromis assumé (review #350) : un compte SANS série paie ici deux
  // requêtes légères pour rien (amitiés, pseudos) — le retour anticipé
  // d'avant les évitait, mais mettait le cercle en série derrière la
  // progression pour tous les autres. Ne pas le remettre.
  const [loaded, linksResult, profilesResult] = await Promise.all([
    loadSeriesProgress(supabase, { withKnownMax: true, includeHidden: true }),
    supabase.from("friendships").select("user_low, user_high, requester_id, status"),
    supabase.rpc("get_circle_profiles"),
  ]);
  if ("error" in loaded) return loaded;
  if (loaded.seriesIds.length === 0) return { progress: [], declarerLabels: {}, gcdLinkedSeriesIds: [] };

  const declarerLabels: Record<string, string> = { [userId]: "toi" };
  const { friendIds } = splitCircleLinks(linksResult.data ?? [], userId);
  const friendSet = new Set(friendIds);
  for (const profile of profilesResult.data ?? []) {
    if (friendSet.has(profile.id)) declarerLabels[profile.id] = profile.display_name;
  }
  return { progress: loaded.progress, declarerLabels, gcdLinkedSeriesIds: loaded.gcdLinkedSeriesIds };
}

/**
 * Le vivier du mode « on continue une série » de la roulette (§4.16) : les
 * tomes suivants déjà dans la pile. Un échec rend un vivier vide — la roulette
 * reste utilisable sans le mode, jamais bloquée. `rows` : les livres que la
 * Pile vient de charger (item 3).
 */
export async function loadSeriesNextInPile(supabase: SessionSupabaseClient, rows?: SeriesBookRow[]): Promise<string[]> {
  const loaded = await loadSeriesProgress(supabase, { rows });
  if ("error" in loaded) {
    console.error("[series] loadSeriesNextInPile:", loaded.error);
    return [];
  }
  return [...nextInPileBookIds(loaded.progress)];
}
