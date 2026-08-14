"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { deleteAccount } from "@/lib/account/actions";

/** Le mot exigé — taper l'irréversible, pas juste le cliquer. */
const CONFIRMATION_WORD = "SUPPRIMER";

/**
 * LA suppression (RGPD) : plus destructif que tout le reste de l'app réuni —
 * la confirmation monte donc d'un cran au-dessus du `confirm()` des gestes de
 * biblio : il faut TAPER le mot. Après suppression, même hygiène qu'à la
 * déconnexion (logout-button) : purge de tous les caches — la coquille "/"
 * précachée est le tableau de bord authentifié du compte qui vient de mourir.
 */
export function DeleteAccountButton() {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    const typed = window.prompt(
      `Toutes tes données seront supprimées définitivement — livres, lectures, notes et avis, photos, historique. ` +
        `Aucun retour en arrière possible (pense à exporter d'abord).\n\nTape ${CONFIRMATION_WORD} pour confirmer :`,
    );
    if (typed !== CONFIRMATION_WORD) return;

    setIsDeleting(true);
    setError(null);
    const result = await deleteAccount();
    if (!result.ok) {
      setIsDeleting(false);
      setError(result.error);
      return;
    }
    // Même purge qu'à la déconnexion : rien de ce compte ne doit rester en cache.
    if ("caches" in window) {
      try {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
      } catch {
        // La purge ne doit jamais bloquer la sortie.
      }
    }
    // Purge de la session LOCALE (review #206) : le JWT du compte mort reste
    // cryptographiquement valide ~1 h et le proxy le vérifie en local (#125) —
    // sans cette purge, /login re-redirigerait vers / et l'utilisateur
    // naviguerait en fantôme dans une app vide. scope local : on n'exige pas
    // que GoTrue reconnaisse un utilisateur qui n'existe plus.
    try {
      const { createBrowserSupabaseClient } = await import("@/lib/supabase/browser");
      await createBrowserSupabaseClient().auth.signOut({ scope: "local" });
    } catch {
      // Au pire, le token expirera — la redirection reste la bonne sortie.
    }
    window.location.href = "/login";
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="danger" block onClick={handleDelete} disabled={isDeleting}>
        {isDeleting ? "Suppression…" : "Supprimer mon compte"}
      </Button>
      {error && (
        <p role="alert" className="text-center text-sm text-red">
          {error}
        </p>
      )}
    </div>
  );
}
