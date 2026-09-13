import "server-only";

import type { KnownMax } from "@/lib/series/derive-series";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Les planchers vivants d'une page de séries (§4.17-4, #299) — UN appel pour
 * toutes les séries, jamais un par série :
 *  - GCD : le plus grand numéro numérique connu par notre import, calculé à
 *    la demande par la RPC `gcd_series_max_issue_numbers` (index
 *    `gcd_issues (series_id, number)`), donc il monte tout seul à chaque
 *    rafraîchissement du dump — et n'est JAMAIS écrit en base ;
 *  - BnF : le plus grand tome déposé PAR ÉDITION, posé par le job de nuit
 *    (`scripts/series-bnf-floor.mts`) sur l'identifiant d'édition
 *    (`series_external_ids.known_max`), avec l'éditeur en libellé.
 * Une déclaration humaine ne se modifie jamais en silence : ces valeurs
 * pré-remplissent et signalent, c'est tout.
 */
type SupabaseLike = Awaited<ReturnType<typeof createServerSupabaseClient>> | ReturnType<typeof createAdminClient>;

export async function fetchKnownMaxBySeriesId(supabase: SupabaseLike, seriesIds: string[]): Promise<Map<string, KnownMax[]>> {
  const result = new Map<string, KnownMax[]>();
  if (seriesIds.length === 0) return result;
  const push = (seriesId: string, known: KnownMax) => result.set(seriesId, [...(result.get(seriesId) ?? []), known]);

  const { data: links, error: linkError } = await supabase
    .from("series_external_ids")
    .select("series_id, source, external_id, known_max, known_max_label")
    .in("series_id", seriesIds);
  if (linkError) {
    console.error("[series] fetchKnownMaxBySeriesId (liens):", linkError.message);
    return result;
  }

  // BnF : déjà en base, une édition = un plancher.
  for (const link of links) {
    if (link.source === "bnf" && link.known_max !== null) {
      push(link.series_id, { source: "bnf", value: link.known_max, label: link.known_max_label });
    }
  }

  // GCD : à la demande. Une série peut porter plusieurs identifiants GCD après fusion : le plus grand gagne.
  const gcdLinks = links.filter((link) => link.source === "gcd");
  const gcdIds = [...new Set(gcdLinks.map((link) => Number(link.external_id)).filter(Number.isInteger))];
  if (gcdIds.length > 0) {
    const { data: maxima, error } = await supabase.rpc("gcd_series_max_issue_numbers", { p_series_ids: gcdIds });
    if (error) {
      console.error("[series] fetchKnownMaxBySeriesId (GCD):", error.message);
    } else {
      const maxByGcdId = new Map(maxima.map((row) => [row.series_id, row.max_number] as const));
      const bestBySeries = new Map<string, number>();
      for (const link of gcdLinks) {
        const max = maxByGcdId.get(Number(link.external_id));
        if (max === undefined || max === null) continue;
        bestBySeries.set(link.series_id, Math.max(bestBySeries.get(link.series_id) ?? 0, max));
      }
      for (const [seriesId, value] of bestBySeries) push(seriesId, { source: "gcd", value, label: null });
    }
  }
  return result;
}
