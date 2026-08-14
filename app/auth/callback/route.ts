import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * GET /auth/callback — le retour du flux Google OAuth : on échange le code
 * contre une session (cookies posés ici), puis on renvoie dans l'app.
 *
 * ⚠️ Piège BoxBox (specs §4.8) : la redirection se construit sur l'ORIGINE
 * RÉELLE de la requête (request.url), jamais sur une constante d'environnement
 * — sinon le login depuis une preview Vercel renverrait sur la prod.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (code) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    // Inscription refusée par la porte d'entrée (#173) : le trigger
    // `handle_new_user` a annulé la création du compte — GoTrue remonte ça en
    // « Database error saving/updating user ». Le message dédié évite de faire
    // passer une invitation manquante pour une panne. Heuristique assumée
    // (review #183) : une VRAIE panne d'insertion de profil matcherait aussi —
    // si un invité légitime voit « pas encore invité », commencer par ici.
    if (/database error (saving|updating)/i.test(error.message)) {
      return NextResponse.redirect(new URL("/login?error=not-invited", request.url));
    }
  }

  // Refus du consentement Google : pas un échec technique, un choix.
  const wasCancelled = request.nextUrl.searchParams.get("error") === "access_denied";
  return NextResponse.redirect(new URL(`/login?error=${wasCancelled ? "cancelled" : "oauth"}`, request.url));
}
