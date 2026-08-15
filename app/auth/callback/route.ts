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
    // Inscription refusée par le plafond (ouverture plafonnée, 15/08/2026 —
    // le seul raise restant du trigger `handle_new_user`) : GoTrue remonte ça
    // en « Database error saving/updating user ». Heuristique assumée (review
    // #183) : une VRAIE panne d'insertion de profil matcherait aussi — si une
    // inscription légitime voit « complet », commencer par ici.
    if (/database error (saving|updating)/i.test(error.message)) {
      return NextResponse.redirect(new URL("/login?error=full", request.url));
    }
  }

  // Refus du consentement Google : pas un échec technique, un choix.
  const wasCancelled = request.nextUrl.searchParams.get("error") === "access_denied";
  return NextResponse.redirect(new URL(`/login?error=${wasCancelled ? "cancelled" : "oauth"}`, request.url));
}
