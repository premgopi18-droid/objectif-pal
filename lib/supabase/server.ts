import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Client Supabase côté serveur, AU NOM DE L'UTILISATEUR : la session vient des
 * cookies, la RLS s'applique. C'est lui qui sert à vérifier « qui appelle ? »
 * dans les Route Handlers et, plus tard, à lire/écrire les données utilisateur
 * (readings, purchases…) — jamais le client service-role pour ça (specs §7).
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
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

/** L'utilisateur de la requête courante, ou null — le garde des Route Handlers. */
export async function getAuthenticatedUser() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
