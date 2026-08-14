"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { SceneConfetti } from "@/app/login/scene-confetti";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

/**
 * L'écran de connexion : un bouton, un tap, pas de mot de passe (specs §4.8).
 * C'est LA page plein décor — l'affiche de l'émission (design-specs §5) : logo,
 * confettis, dégradé signature.
 *
 * Le redirectTo se construit sur window.location.origin — l'origine réelle,
 * jamais une constante — pour que le login marche aussi depuis une preview.
 * ⚠️ Logique OAuth intouchée : ce chantier ne rhabille que le markup.
 */
function LoginContent() {
  const searchParams = useSearchParams();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const errorMessage = {
    oauth: "La connexion a échoué — réessaie.",
    cancelled: "Connexion annulée.",
    // La porte d'entrée (#173) : compte Google valide, mais pas encore invité.
    "not-invited": "Ce compte n'est pas encore invité — l'accès se fait sur invitation, demande à Prem ou Léna.",
  }[searchParams.get("error") ?? ""];

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
    <main
      className="relative flex min-h-dvh flex-col items-center justify-center gap-10 overflow-hidden px-6 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]"
    >
      <SceneConfetti />

      <div className="relative z-10 flex flex-col items-center gap-3 text-center">
        {/* Le logo — « PAL » porte le dégradé signature (§2). */}
        <h1 className="text-4xl font-black uppercase italic tracking-tight">
          Objectif <span className="bg-grad bg-clip-text text-transparent">PAL</span>
        </h1>
        <p className="max-w-xs text-sm text-ink2">
          Scanne tes lectures, fais fondre ta pile à lire, et donne tes chiffres à l&apos;antenne.
        </p>
      </div>

      <Card className="relative z-10 flex w-full max-w-xs flex-col gap-4">
        <Button type="button" variant="grad" block onClick={signInWithGoogle} disabled={isSigningIn}>
          {isSigningIn ? "Redirection…" : "Continuer avec Google"}
        </Button>

        {errorMessage && (
          <p role="alert" className="text-center text-sm text-red">
            {errorMessage}
          </p>
        )}
      </Card>
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
