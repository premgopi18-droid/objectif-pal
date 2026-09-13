"use server";

import { revalidatePath } from "next/cache";
import { getSessionOrError } from "@/lib/supabase/server";
import { userFacingSqlError } from "@/lib/supabase/user-facing-sql-error";

/**
 * Les gestes sur le référentiel partagé de séries (lot A de l'epic #289,
 * specs §4.17) — tous en SQL, dans des RPC `security definer` qui vérifient
 * l'appelant, consomment le quota `series_write` et journalisent dans
 * `series_events` : déclarer le total ou la parution en cours, renommer,
 * fusionner deux graphies, relier un de ses livres. Ici, on ne fait que
 * traduire le résultat pour l'écran (les refus `UX:` remontent tels quels,
 * tout le reste part sur le message générique — §8).
 *
 * Les surfaces revalidées sont celles qui affichent des séries : la Biblio
 * (segment Séries, lot B) et le Bilan (Stats, lot C). Le Journal montre le
 * nom de série, qu'un renommage change aussi.
 */

export type SeriesActionResult = { ok: true } | { ok: false; error: string };

const SERIES_SURFACES = ["/bibliotheque", "/journal", "/bilan"] as const;

type SessionSupabase = NonNullable<Awaited<ReturnType<typeof getSessionOrError>>>["supabase"];
type RpcOutcome = PromiseLike<{ error: { code?: string; message: string } | null }>;

async function callSeriesRpc(label: string, invoke: (supabase: SessionSupabase) => RpcOutcome): Promise<SeriesActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };

  const { error } = await invoke(session.supabase);
  if (error) {
    console.error(`[series] ${label}:`, error.message);
    return { ok: false, error: userFacingSqlError(error.code, error.message) };
  }
  for (const surface of SERIES_SURFACES) revalidatePath(surface);
  return { ok: true };
}

/** Un total (« 12 tomes ») OU une parution en cours — la RPC refuse les deux et l'absence des deux. */
export async function declareSeriesFact(
  seriesId: string,
  fact: { totalVolumes: number } | { isOngoing: true },
): Promise<SeriesActionResult> {
  const totalVolumes = "totalVolumes" in fact ? fact.totalVolumes : null;
  if (totalVolumes !== null && (!Number.isInteger(totalVolumes) || totalVolumes < 1)) {
    return { ok: false, error: "Le total doit être un nombre entier positif." };
  }
  return callSeriesRpc("declareSeriesFact", (supabase) =>
    supabase.rpc("declare_series_fact", {
      p_series_id: seriesId,
      p_total_volumes: totalVolumes ?? undefined,
      p_is_ongoing: totalVolumes === null,
    }),
  );
}

export async function renameSeries(seriesId: string, name: string): Promise<SeriesActionResult> {
  if (!name.trim()) return { ok: false, error: "Le nom de la série est vide." };
  return callSeriesRpc("renameSeries", (supabase) => supabase.rpc("rename_series", { p_series_id: seriesId, p_name: name }));
}

/** La série conservée absorbe l'autre — pour TOUS les comptes (référentiel commun). */
export async function mergeSeries(keepSeriesId: string, mergeSeriesId: string): Promise<SeriesActionResult> {
  return callSeriesRpc("mergeSeries", (supabase) =>
    supabase.rpc("merge_series", { keep_series_id: keepSeriesId, merge_series_id: mergeSeriesId }),
  );
}

/** Relier (ou détacher, `null`) UN de ses livres à une série du référentiel. */
export async function linkBookSeries(bookId: string, seriesId: string | null): Promise<SeriesActionResult> {
  return callSeriesRpc("linkBookSeries", (supabase) =>
    supabase.rpc("link_book_series", { p_book_id: bookId, p_series_id: seriesId ?? undefined }),
  );
}
