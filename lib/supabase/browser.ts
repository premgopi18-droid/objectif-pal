"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Client Supabase NAVIGATEUR — clé anon, RLS active, session dans les cookies
 * (c'est ce qui permet au serveur — proxy et Route Handlers — de la voir).
 */
export function createBrowserSupabaseClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
