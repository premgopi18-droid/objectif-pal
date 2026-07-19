"use client";

import { Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInstallPrompt } from "@/lib/hooks/use-install-prompt";

/**
 * La bannière d'installation (#89) : une ligne discrète en HAUT de l'écran
 * (le bas est pris par la barre d'onglets + FAB scan), montée dans le layout
 * (app) uniquement — pas sur /login, l'utilisateur n'y est pas encore engagé.
 *
 * Deux variantes : CTA « Installer » quand le prompt natif Chromium est capté,
 * consigne Partager sur iOS Safari (pas de prompt programmatique là-bas).
 * La croix ferme pour toujours (localStorage) — l'option du Profil, elle, reste.
 *
 * z-20 : au-dessus du contenu, sous la toast (z-50) et la splash (z-100) qui
 * la recouvre le temps de son fondu (~1 s) — cohabitation voulue.
 */
export function InstallBanner() {
  const { isIOS, showBanner, install, dismissBanner } = useInstallPrompt();

  if (!showBanner) return null;

  return (
    <div
      role="region"
      aria-label="Installer l'application"
      className="sticky top-0 z-20 border-b border-line bg-card px-4 py-2.5"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink">Installe Objectif PAL sur ton téléphone</p>
          {isIOS && (
            <p className="text-xs text-ink2">
              Appuie sur <Share size={12} aria-hidden className="inline shrink-0" /> Partager puis
              « Sur l&apos;écran d&apos;accueil »
            </p>
          )}
        </div>

        {!isIOS && (
          <Button type="button" onClick={install} className="min-h-11 shrink-0">
            Installer
          </Button>
        )}

        <button
          type="button"
          onClick={dismissBanner}
          aria-label="Ne plus proposer l'installation"
          className="grid size-11 shrink-0 place-items-center rounded-xl text-ink2 transition
            active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
        >
          <X size={18} aria-hidden />
        </button>
      </div>
    </div>
  );
}
