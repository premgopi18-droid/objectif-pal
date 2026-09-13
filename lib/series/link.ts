import "server-only";

import type { BookCategory } from "@/lib/scoring/types";
import type { SeriesExternalRef } from "@/lib/resolution/types";
import type { createServerSupabaseClient } from "@/lib/supabase/server";

type SessionSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

/**
 * Le rattachement d'un livre au référentiel partagé (lot A de l'epic #289,
 * specs §4.17-2) — UN appel, la RPC `find_or_create_series` fait tout :
 * identifiant externe d'abord (GCD, BnF), nom normalisé ensuite, création
 * sinon, verrou sur le nom contre les scans simultanés.
 *
 * JAMAIS bloquant (§8, dégradation douce) : un référentiel qui tousse ne doit
 * pas faire échouer le scan ni l'édition — le livre garde son `series_name`,
 * le lien se refera à la prochaine écriture (édition de fiche, rescan).
 */
export async function findOrCreateSeriesId(
  supabase: SessionSupabaseClient,
  input: { seriesName: string | null; category: BookCategory; seriesRef?: SeriesExternalRef | null },
): Promise<string | null> {
  if (!input.seriesName?.trim()) return null;
  const { data, error } = await supabase.rpc("find_or_create_series", {
    p_name: input.seriesName,
    p_category: input.category,
    p_bnf_series_id: input.seriesRef?.source === "bnf" ? input.seriesRef.id : undefined,
    p_gcd_series_id: input.seriesRef?.source === "gcd" ? input.seriesRef.id : undefined,
  });
  if (error) {
    console.error("[series] findOrCreateSeriesId:", error.message);
    return null;
  }
  return data ?? null;
}
