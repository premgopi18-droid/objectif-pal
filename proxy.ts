import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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

  // getUser() valide le JWT et déclenche le refresh si besoin — le seul appel
  // auth réseau du cycle de requête.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublicPath =
    path === "/sw.js" ||
    path === "/manifest.webmanifest" ||
    path.startsWith("/icons/") ||
    path.startsWith("/login") ||
    path.startsWith("/auth");

  // Les APIs se gardent elles-mêmes (401) : on ne les redirige jamais.
  if (path.startsWith("/api")) return supabaseResponse;

  if (!user && !isPublicPath) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (user && path.startsWith("/login")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return supabaseResponse;
}

export const config = {
  // Exclut les assets statiques ; manifest, sw.js et images restent hors gating
  // (cf. isPublicPath pour la défense en profondeur).
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
