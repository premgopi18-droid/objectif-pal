"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
    <button
      type="button"
      onClick={signOut}
      disabled={isSigningOut}
      className="rounded-full border border-foreground/20 px-5 py-2.5 text-sm font-medium transition-opacity disabled:opacity-50"
    >
      {isSigningOut ? "Déconnexion…" : "Se déconnecter"}
    </button>
  );
}
