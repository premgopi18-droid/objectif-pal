"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

export function LogoutButton() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function signOut() {
    setIsSigningOut(true);
    // Appareil partagé : le service worker précache "/" — le tableau de bord
    // AUTHENTIFIÉ de ce compte. On purge TOUS les caches (pas de nom en dur :
    // CACHE_NAME vit dans sw.js et change à chaque bump) avant de partir,
    // sinon le prochain utilisateur retrouve nos données hors ligne.
    // Après la purge, le fetch handler du SW laisse naturellement le réseau
    // répondre (réseau d'abord, cache en secours) ; la coquille hors-ligne ne
    // se reconstituera qu'à la prochaine réinstallation du SW (prochain
    // déploiement) — acceptable, la purge protège la vie privée d'abord.
    if ("caches" in window) {
      try {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
      } catch {
        // La purge ne doit jamais bloquer la déconnexion elle-même.
      }
    }
    await createBrowserSupabaseClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    // Button ghost + encre rouge (déconnexion = sémantique négatif, specs §2).
    // Le token passe par `style` (var(--red)) : inline il l'emporte à coup sûr
    // sur le `text-ink` de la variante ghost, sans dépendre de l'ordre Tailwind.
    <Button
      type="button"
      variant="ghost"
      block
      onClick={signOut}
      disabled={isSigningOut}
      style={{ color: "var(--red)" }}
    >
      {isSigningOut ? "Déconnexion…" : "Se déconnecter"}
    </Button>
  );
}
