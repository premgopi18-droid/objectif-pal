import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Client Supabase côté serveur, AU NOM DE L'UTILISATEUR : la session vient des
 * cookies, la RLS s'applique. C'est lui qui sert à vérifier « qui appelle ? »
 * dans les Route Handlers et, plus tard, à lire/écrire les données utilisateur
 * (readings, purchases…) — jamais le client service-role pour ça (specs §7).
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Appelé depuis un Server Component : l'écriture de cookies y est impossible, sans gravité.
        }
      },
    },
  });
}

/**
 * La frontière d'authentification (#125) — qui vérifie quoi :
 *  - le PROXY vérifie le JWT LOCALEMENT (`getClaims()`, clé publique ES256) et
 *    porte le refresh de session — zéro réseau sur le chemin nominal ;
 *  - les gardes ci-dessous (`getUser()`) font la vérification serveur COMPLÈTE
 *    — révocation immédiate comprise — car ils protègent des ÉCRITURES et des
 *    lectures de données. Ne pas les « optimiser » en getClaims : sur une
 *    action, les ~100 ms valent la certitude.
 */

/** L'utilisateur de la requête courante, ou null — le garde des Route Handlers. */
export async function getAuthenticatedUser() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Client + utilisateur de la session courante, ou null — le garde des Server Actions. */
export async function getSessionOrError() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? ({ supabase, user } as const) : null;
}
