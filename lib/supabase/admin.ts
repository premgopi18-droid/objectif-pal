import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Client Supabase SERVEUR — service role, donc il BYPASSE la RLS.
 *
 * Réservé aux lectures des tables de référence (gcd_issues, gcd_series) et aux
 * écritures du cache de résolutions (barcode_cache) : les seules écritures que
 * la RLS interdit au client, par design (specs §7). Ne JAMAIS l'utiliser pour
 * des données utilisateur — elles passent par le client authentifié, RLS active.
 */
export function createAdminClient(): SupabaseClient<Database> {
  // La clé service role ne doit jamais atteindre un navigateur.
  if (typeof window !== "undefined") {
    throw new Error("createAdminClient est réservé au serveur");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis");
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
