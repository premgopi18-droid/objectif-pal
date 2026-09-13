import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * L'indice GCD vivant (§4.17-4) : pour des séries du référentiel reliées à
 * une série GCD, le plus grand numéro que notre import connaît. Calculé à
 * l'affichage par la RPC `gcd_series_max_issue_numbers` (index
 * `gcd_issues (series_id, number)`), donc il monte tout seul à chaque
 * rafraîchissement du dump — et n'est JAMAIS écrit en base : une déclaration
 * humaine ne se modifie pas en silence.
 *
 * UN appel pour toutes les séries d'une page (jamais un par série).
 */
type SupabaseLike = Awaited<ReturnType<typeof createServerSupabaseClient>> | ReturnType<typeof createAdminClient>;

export async function fetchGcdKnownMaxBySeriesId(
  supabase: SupabaseLike,
  seriesIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (seriesIds.length === 0) return result;

  const { data: links, error: linkError } = await supabase
    .from("series_external_ids")
    .select("series_id, external_id")
    .eq("source", "gcd")
    .in("series_id", seriesIds);
  if (linkError) {
    console.error("[series] fetchGcdKnownMaxBySeriesId (liens):", linkError.message);
    return result;
  }
  const gcdIds = [...new Set(links.map((link) => Number(link.external_id)).filter(Number.isInteger))];
  if (gcdIds.length === 0) return result;

  const { data: maxima, error } = await supabase.rpc("gcd_series_max_issue_numbers", { p_series_ids: gcdIds });
  if (error) {
    console.error("[series] fetchGcdKnownMaxBySeriesId (max):", error.message);
    return result;
  }
  const maxByGcdId = new Map(maxima.map((row) => [row.series_id, row.max_number] as const));
  for (const link of links) {
    const max = maxByGcdId.get(Number(link.external_id));
    if (max === undefined || max === null) continue;
    // Une série peut porter plusieurs identifiants GCD après fusion : le plus grand gagne.
    result.set(link.series_id, Math.max(result.get(link.series_id) ?? 0, max));
  }
  return result;
}
