"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Client Supabase NAVIGATEUR — clé anon, RLS active, session dans les cookies
 * (c'est ce qui permet au serveur — proxy et Route Handlers — de la voir).
 */
export function createBrowserSupabaseClient() {
  return createBrowserClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
