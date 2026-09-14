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
import { fetchKnownMaxBySeriesId } from "@/lib/series/known-max";
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
 * La progression de toutes les séries de l'utilisateur : ses livres reliés
 * (avec leurs faits — la règle de pile a besoin des dates), les séries du
 * référentiel qu'ils touchent, les planchers vivants (GCD, éditions BnF) si demandés. Requêtes
 * bornées par les séries de l'utilisateur, jamais une par série. Partagé par
 * le segment (lot B), les Stats et la roulette (lot C).
 */
export async function loadSeriesProgress(
  supabase: SessionSupabaseClient,
  options: { withKnownMax?: boolean } = {},
): Promise<{ progress: SeriesProgress[]; seriesIds: string[] } | LoadFailure> {
  const { data: rows, error: booksError } = await supabase
    .from("books")
    .select(
      `id, title, series_id, category, issue_number, cover_url,
       purchases (purchased_at, deleted_at),
       readings (status, finished_at, deleted_at),
       ownerships (owned_since, disposed_at, deleted_at)`,
    )
    .is("deleted_at", null)
    .not("series_id", "is", null)
    .is("purchases.deleted_at", null)
    .is("readings.deleted_at", null)
    .is("ownerships.deleted_at", null);
  if (booksError) return { error: booksError.message };

  const books: SeriesBookFact[] = (rows ?? []).flatMap((row) =>
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
            purchases: (row.purchases ?? []).map((purchase) => ({ purchasedAt: purchase.purchased_at, deletedAt: purchase.deleted_at })),
            readings: (row.readings ?? []).map((reading) => ({
              status: reading.status,
              finishedAt: reading.finished_at,
              deletedAt: reading.deleted_at,
            })),
            ownerships: (row.ownerships ?? []).map((ownership) => ({
              ownedSince: ownership.owned_since,
              disposedAt: ownership.disposed_at,
              deletedAt: ownership.deleted_at,
            })),
          },
        ],
  );
  const seriesIds = [...new Set(books.map((book) => book.seriesId))];
  if (seriesIds.length === 0) return { progress: [], seriesIds: [] };

  const [seriesResult, knownMax] = await Promise.all([
    supabase
      .from("series")
      .select("id, name, category, total_volumes, is_ongoing, fact_declared_by, fact_declared_at, fact_source")
      .in("id", seriesIds),
    options.withKnownMax ? fetchKnownMaxBySeriesId(supabase, seriesIds) : Promise.resolve(new Map<string, KnownMax[]>()),
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
    factSource: row.fact_source === "gcd" ? "gcd" : "human",
  }));

  return { progress: deriveSeries(seriesList, books, knownMax), seriesIds };
}

/** Le segment « Séries » : la progression + les pseudos du cercle + les liens GCD (pour la bannière). */
export async function loadSeriesSegment(supabase: SessionSupabaseClient, userId: string): Promise<SeriesSegmentData | LoadFailure> {
  const loaded = await loadSeriesProgress(supabase, { withKnownMax: true });
  if ("error" in loaded) return loaded;
  if (loaded.seriesIds.length === 0) return { progress: [], declarerLabels: {}, gcdLinkedSeriesIds: [] };

  const [gcdLinksResult, linksResult, profilesResult] = await Promise.all([
    supabase.from("series_external_ids").select("series_id").eq("source", "gcd").in("series_id", loaded.seriesIds),
    supabase.from("friendships").select("user_low, user_high, requester_id, status"),
    supabase.rpc("get_circle_profiles"),
  ]);

  const declarerLabels: Record<string, string> = { [userId]: "toi" };
  const { friendIds } = splitCircleLinks(linksResult.data ?? [], userId);
  const friendSet = new Set(friendIds);
  for (const profile of profilesResult.data ?? []) {
    if (friendSet.has(profile.id)) declarerLabels[profile.id] = profile.display_name;
  }

  return {
    progress: loaded.progress,
    declarerLabels,
    gcdLinkedSeriesIds: [...new Set((gcdLinksResult.data ?? []).map((link) => link.series_id))],
  };
}

/**
 * Le vivier du mode « on continue une série » de la roulette (§4.16) : les
 * tomes suivants déjà dans la pile. Un échec rend un vivier vide — la roulette
 * reste utilisable sans le mode, jamais bloquée.
 */
export async function loadSeriesNextInPile(supabase: SessionSupabaseClient): Promise<string[]> {
  const loaded = await loadSeriesProgress(supabase);
  if ("error" in loaded) {
    console.error("[series] loadSeriesNextInPile:", loaded.error);
    return [];
  }
  return [...nextInPileBookIds(loaded.progress)];
}
