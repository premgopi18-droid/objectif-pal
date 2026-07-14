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
  }

  return NextResponse.redirect(new URL("/login?error=oauth", request.url));
}
