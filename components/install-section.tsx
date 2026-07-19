"use client";

import { Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInstallPrompt } from "@/lib/hooks/use-install-prompt";

/**
 * La section « Application » du Profil (#89) : le point d'entrée PERMANENT vers
 * l'installation, contrairement à la bannière qu'on peut fermer. Trois variantes :
 * bouton natif (prompt Chromium capté), consigne iOS Safari, ou renvoi vers le
 * menu du navigateur (desktop, Brave et Chromium modifiés qui neutralisent
 * `beforeinstallprompt` mais installent très bien via leur menu — les masquer
 * les priverait du seul point d'entrée, cf. deriveInstallVisibility).
 *
 * Disparaît entièrement (titre compris) une fois l'app installée — d'où le
 * composant client qui porte sa propre <section>, rendu null côté serveur.
 */
export function InstallSection({ labelClassName }: { labelClassName: string }) {
  const { isIOS, showInSettings, canPromptInstall, install } = useInstallPrompt();

  if (!showInSettings) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className={labelClassName}>Application</h2>
      {canPromptInstall ? (
        // Chromium avec prompt natif capté : installation en un tap.
        <>
          <p className="text-sm text-ink2">
            Plein écran, icône sur l&apos;écran d&apos;accueil, scan plus rapide.
          </p>
          <Button type="button" block onClick={install}>
            Installer l&apos;app
          </Button>
        </>
      ) : isIOS ? (
        // iOS Safari : pas de prompt programmatique → consigne Partager.
        <p className="text-sm leading-relaxed text-ink2">
          Pour installer l&apos;app : appuie sur{" "}
          <Share size={13} aria-hidden className="inline shrink-0" /> Partager dans Safari, puis
          « Sur l&apos;écran d&apos;accueil ».
        </p>
      ) : (
        // Desktop ou navigateur sans prompt (Brave…) : renvoi vers son menu.
        <p className="text-sm leading-relaxed text-ink2">
          Pour installer l&apos;app : ouvre le menu de ton navigateur et choisis
          « Installer l&apos;app » ou « Ajouter à l&apos;écran d&apos;accueil ».
        </p>
      )}
    </section>
  );
}
