import type { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Le rate-limiting des actions coûteuses (issue #32 lot A, durci par #174) :
 * un compteur à fenêtre fixe par utilisateur ET par type d'action, en base.
 * Bénin en solo, vital à plusieurs — un seul utilisateur en boucle grillerait
 * les quotas externes PARTAGÉS (Google Books 1 000 req/jour, Metron) et
 * gonflerait barcode_cache sans borne.
 *
 * ⚠️ Les SEUILS vivent dans la fonction SQL `consume_action_quota` (migration
 * 20260814100100), pas ici : la RPC est appelable par tout authentifié, des
 * seuils passés en paramètres seraient choisis par l'attaquant (#174). Pour
 * mémoire : lookup 60/min (physiquement inatteignable au scanner, #126),
 * cover_repair 5/min (#177).
 *
 * Le compteur vit en BASE : il survit aux cold starts Vercel, contrairement à
 * un compteur mémoire.
 */

/** Les types d'action métrés — en phase avec le CHECK de la table. */
export type QuotaKind = "lookup" | "cover_repair";

/** Le message du 429 — partagé entre la route et l'écran de scan. */
export const LOOKUP_RATE_LIMIT_MESSAGE = "Trop de recherches d'un coup — attends une minute et réessaie.";

type SessionSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

/**
 * Consomme une unité de quota et dit si l'action est permise. FAIL-OPEN : une
 * panne du compteur ne bloque jamais l'utilisateur (dégradation douce, specs
 * §8) — le rate-limit protège des quotas, il n'est pas une frontière de
 * sécurité. L'échec est loggé pour rester visible (#181).
 */
export async function isActionAllowed(supabase: SessionSupabaseClient, kind: QuotaKind): Promise<boolean> {
  const { data: allowed, error } = await supabase.rpc("consume_action_quota", {
    action_kind: kind,
  });
  if (error) {
    console.error(`[quota] compteur "${kind}" en échec, on laisse passer :`, error.message);
    return true;
  }
  return allowed === true;
}

/** Le quota du scan — consommé par /api/lookup avant toute cascade. */
export async function isLookupAllowed(supabase: SessionSupabaseClient): Promise<boolean> {
  return isActionAllowed(supabase, "lookup");
}
