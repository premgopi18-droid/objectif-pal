"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

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
    // Import DYNAMIQUE (#123) : le chunk @supabase/supabase-js (63 KB gz) ne
    // doit pas être dans le First Load de /profil pour un bouton cliqué une
    // fois par lune — il ne part sur le réseau qu'au geste.
    const { createBrowserSupabaseClient } = await import("@/lib/supabase/browser");
    await createBrowserSupabaseClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    // Déconnexion = sémantique négatif (specs §2) : la variante `danger` porte
    // l'encre rouge elle-même (#84) — plus de style inline à surcharger ici.
    <Button type="button" variant="danger" block onClick={signOut} disabled={isSigningOut}>
      {isSigningOut ? "Déconnexion…" : "Se déconnecter"}
    </Button>
  );
}
