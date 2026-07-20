import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath } from "@/lib/auth/public-paths";

/**
 * Le proxy (l'ex-middleware, renommé en Next 16) : rafraîchit la session
 * Supabase à chaque requête et garde les pages derrière le login.
 *
 * - Pages : pas de session → redirection vers /login (et /login → / si connecté).
 * - /api/* : JAMAIS de redirection (un fetch recevrait du HTML) — chaque Route
 *   Handler se garde lui-même en 401 ; ici on ne fait que rafraîchir les cookies.
 * - Ressources PWA (manifest, sw.js, icônes) : publiques par nécessité — le
 *   navigateur les récupère sans cookies, une redirection rendrait l'app
 *   non installable. Exclues par le matcher ET par isPublicPath (défense en
 *   profondeur, piège vécu sur f1-pronostics).
 */
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
        },
      },
    },
  );

  // getClaims() (#125) : vérification LOCALE du JWT contre la clé publique
  // ES256 du projet (JWKS, mise en cache par le SDK) — plus d'aller-retour
  // réseau vers Supabase Auth à chaque requête (~100-150 ms gagnés). Le
  // REFRESH d'une session expirée reste déclenché par cet appel (c'est le
  // vrai rôle du proxy), et lui seul repart sur le réseau, quand il le faut.
  // La vérification serveur COMPLÈTE (révocation immédiate) reste dans les
  // server actions d'écriture via getUser() — cf. lib/supabase/server.ts.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims ?? null;

  // La liste des chemins publics vit dans lib/auth/public-paths.ts — pure et
  // TESTÉE (le contrat anti-régression de l'issue #60).
  const path = request.nextUrl.pathname;

  // Les APIs se gardent elles-mêmes (401) : on ne les redirige jamais.
  if (path.startsWith("/api")) return supabaseResponse;

  // Les redirections repartent d'une réponse neuve : on y recopie les cookies
  // de session que getUser() vient éventuellement de rafraîchir, sinon le
  // refresh serait jeté (pattern canonique Supabase SSR).
  const redirectPreservingSession = (destination: string) => {
    const response = NextResponse.redirect(new URL(destination, request.url));
    supabaseResponse.cookies.getAll().forEach(({ name, value, ...options }) => {
      response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]);
    });
    return response;
  };

  if (!user && !isPublicPath(path)) {
    return redirectPreservingSession("/login");
  }
  if (user && path.startsWith("/login")) {
    return redirectPreservingSession("/");
  }

  return supabaseResponse;
}

export const config = {
  // Exclut les assets statiques ; manifest, sw.js, wasm et images restent hors
  // gating (cf. isPublicPath pour la défense en profondeur).
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|sw\\.js|wasm/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
