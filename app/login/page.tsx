"use client";

import { BookOpenCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

/**
 * L'écran de connexion : un bouton, un tap, pas de mot de passe (specs §4.8).
 * Le redirectTo se construit sur window.location.origin — l'origine réelle,
 * jamais une constante — pour que le login marche aussi depuis une preview.
 */
function LoginContent() {
  const searchParams = useSearchParams();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const hasOauthError = searchParams.get("error") === "oauth";

  async function signInWithGoogle() {
    setIsSigningIn(true);
    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setIsSigningIn(false);
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <BookOpenCheck aria-hidden className="size-14 text-amber-500" />
        <h1 className="text-3xl font-bold">Objectif PAL</h1>
        <p className="text-sm opacity-70">
          Scanne tes lectures, fais fondre ta pile à lire, et donne tes chiffres à l&apos;antenne.
        </p>
      </div>

      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={isSigningIn}
        className="w-full max-w-xs rounded-full bg-foreground px-6 py-3.5 font-medium text-background transition-opacity disabled:opacity-50"
      >
        {isSigningIn ? "Redirection…" : "Continuer avec Google"}
      </button>

      {hasOauthError && (
        <p role="alert" className="text-sm text-red-500">
          La connexion a échoué — réessaie.
        </p>
      )}
    </main>
  );
}

export default function LoginPage() {
  // useSearchParams exige une frontière Suspense au build (rendu statique).
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
