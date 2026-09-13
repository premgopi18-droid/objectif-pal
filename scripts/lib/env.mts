/**
 * Le socle commun des scripts de prod (audit #274) — écrit UNE fois, au lieu
 * du bloc « .env.local + service role » recopié dans chaque script.
 *
 *  - `loadLocalEnv()` : en local, `.env.local` complète l'environnement (jamais
 *    l'inverse — en CI, les secrets du workflow font foi) ;
 *  - `createAdminClientFromEnv()` : le client SERVICE ROLE typé sur le schéma
 *    de prod. ⚠️ Il bypasse la RLS : chaque requête d'un script filtre
 *    `user_id` explicitement, ou cible un `id` précis (la règle maison).
 *
 * Le runner (package.json) est `node --conditions=react-server --import tsx` :
 * la condition rend `server-only` inerte hors de Next (c'est son `exports`).
 * Elle fait aussi résoudre React et tout paquet qui l'expose vers leur variante
 * serveur — sans conséquence tant qu'un script n'importe ni composant ni
 * `next/*` (review #287). Si un cinquième script en a besoin, c'est ici que
 * ça se décide.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export function loadLocalEnv(): void {
  try {
    for (const line of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
      const eq = line.indexOf("=");
      if (eq < 1 || line.startsWith("#")) continue;
      const key = line.slice(0, eq).trim();
      if (!process.env[key]) process.env[key] = line.slice(eq + 1).trim();
    }
  } catch {
    // Pas de .env.local (CI) : l'environnement doit suffire.
  }
}

/** L'URL Supabase et le client admin, ou une sortie franche si les secrets manquent. */
export function createAdminClientFromEnv() {
  loadLocalEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis");
    process.exit(1);
  }
  return { url, admin: createClient<Database>(url, serviceRoleKey, { auth: { persistSession: false } }) };
}

export const isDryRun = (): boolean => process.argv.includes("--dry-run");
