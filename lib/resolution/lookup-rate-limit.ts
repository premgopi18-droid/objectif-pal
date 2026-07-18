import type { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Le rate-limiting de /api/lookup (issue #32, lot A) : N lookups par minute
 * et par utilisateur. Bénin en solo, vital à plusieurs — un seul utilisateur
 * en boucle grillerait les quotas externes PARTAGÉS (Google Books 1 000
 * req/jour, Metron) et gonflerait barcode_cache sans borne. 30/min est
 * inatteignable en scannant physiquement (~10/min en rafale) : un usage
 * normal n'est jamais bloqué.
 *
 * Le compteur vit en BASE (fonction `consume_lookup_quota`, atomique) : il
 * survit aux cold starts Vercel, contrairement à un compteur mémoire.
 */

export const LOOKUP_RATE_LIMIT = {
  maxLookups: 30,
  windowSeconds: 60,
} as const;

/** Le message du 429 — partagé entre la route et l'écran de scan. */
export const LOOKUP_RATE_LIMIT_MESSAGE = "Trop de recherches d'un coup — attends une minute et réessaie.";

type SessionSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

/**
 * Consomme une unité de quota et dit si le lookup est permis. FAIL-OPEN : une
 * panne du compteur ne bloque jamais le scan (dégradation douce, specs §8) —
 * le rate-limit protège des quotas, il n'est pas une frontière de sécurité.
 */
export async function isLookupAllowed(supabase: SessionSupabaseClient): Promise<boolean> {
  const { data: allowed, error } = await supabase.rpc("consume_lookup_quota", {
    max_lookups: LOOKUP_RATE_LIMIT.maxLookups,
    window_seconds: LOOKUP_RATE_LIMIT.windowSeconds,
  });
  if (error) {
    console.error("[lookup] rate-limit en échec, on laisse passer :", error.message);
    return true;
  }
  return allowed === true;
}
