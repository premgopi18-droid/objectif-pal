import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Les quotas GLOBAUX (issue #175) — par application, pas par utilisateur : la
 * clé Google Books (1 000 req/jour) et le compte Metron (20 req/min) sont
 * partagés par tous. Les seuils vivent dans la fonction SQL
 * `consume_global_quota` (migration 20260814200000) : 900/jour Google Books,
 * 15/min Metron — un appel HTTP consommé = un tick.
 *
 * FAIL-OPEN comme le quota par utilisateur (specs §8) : une panne du compteur
 * ne coupe pas le scan — elle est loggée pour rester visible (#181).
 */

export type GlobalQuotaKind = "google_books_daily" | "metron";

type AdminClient = ReturnType<typeof createAdminClient>;

export async function consumeGlobalQuota(kind: GlobalQuotaKind, client?: AdminClient): Promise<boolean> {
  const admin = client ?? createAdminClient();
  const { data: allowed, error } = await admin.rpc("consume_global_quota", { action_kind: kind });
  if (error) {
    console.error(`[quota] compteur global "${kind}" en échec, on laisse passer :`, error.message);
    return true;
  }
  return allowed === true;
}
