"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { renderShareCard, shareCardBlob } from "@/lib/share/render-card";
import { SHARE_THEMES, type ShareTheme } from "@/lib/share/themes";
import type { ShareCardData } from "@/lib/share/card-data";

/**
 * Le composeur de carte (§4.15) — la partie RÉUTILISABLE de la feuille de
 * partage : vignettes des thèmes, aperçu canvas (qui EST l'image partagée),
 * bouton de partage natif avec repli téléchargement. Extrait de la ShareSheet
 * pour servir aussi la carte d'invité : deux surfaces, UN rendu.
 *
 * L'image se dessine SUR L'APPAREIL — rien ne part sur un serveur. Le thème
 * choisi est mémorisé (localStorage, best effort : un échec de stockage ne
 * casse jamais le geste).
 */

const LAST_THEME_STORAGE_KEY = "objectif-pal:share-card-theme";

/**
 * Le thème mémorisé, lu via `useSyncExternalStore` : contrairement à la
 * ShareSheet (montée au tap), la carte d'invité est rendue côté serveur —
 * lire localStorage dans un initialiseur d'état ferait diverger l'hydratation.
 * Le serveur voit `null` (premier thème), le client se recale tout seul.
 */
const subscribeToNothing = () => () => {};
const serverThemeId = (): string | null => null;
function readStoredThemeId(): string | null {
  try {
    return localStorage.getItem(LAST_THEME_STORAGE_KEY);
  } catch {
    // Stockage indisponible (navigation privée…) : le premier thème fera l'affaire.
    return null;
  }
}

type CardComposerProps = {
  data: ShareCardData;
  avatarUrl: string | null;
  /** Le nom du fichier partagé/téléchargé (extension .jpg comprise). */
  fileName: string;
  onToast: (message: string) => void;
  /** Appelé après un partage ou téléchargement réussi (la ShareSheet s'y ferme). */
  onShared?: () => void;
};

export function CardComposer({ data, avatarUrl, fileName, onToast, onShared }: CardComposerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const storedId = useSyncExternalStore(subscribeToNothing, readStoredThemeId, serverThemeId);
  const [chosenTheme, setChosenTheme] = useState<ShareTheme | null>(null);
  const theme = chosenTheme ?? SHARE_THEMES.find((candidate) => candidate.id === storedId) ?? SHARE_THEMES[0];
  const [isRendering, setIsRendering] = useState(true);
  const [renderError, setRenderError] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  // Le rendu suit le thème et les données ; un rendu dépassé (tap rapide sur
  // les vignettes, saisie au clavier) ne doit pas écraser l'état du dernier demandé.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    let cancelled = false;
    setIsRendering(true);
    setRenderError(false);
    renderShareCard(canvas, theme, data, avatarUrl)
      .then(() => {
        if (!cancelled) setIsRendering(false);
      })
      .catch(() => {
        if (cancelled) return;
        setIsRendering(false);
        setRenderError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [theme, data, avatarUrl]);

  const chooseTheme = useCallback((next: ShareTheme) => {
    setChosenTheme(next);
    try {
      localStorage.setItem(LAST_THEME_STORAGE_KEY, next.id);
    } catch {
      // Mémorisation seulement — jamais bloquant.
    }
  }, []);

  async function shareImage() {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    setIsSharing(true);
    try {
      const blob = await shareCardBlob(canvas);
      const file = new File([blob], fileName, { type: "image/jpeg" });
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          onShared?.();
          return;
        } catch (error) {
          // Refermer la feuille native n'est pas une erreur.
          if (error instanceof DOMException && error.name === "AbortError") return;
          // Autre refus : on retombe sur le téléchargement.
        }
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.click();
      URL.revokeObjectURL(url);
      onToast("Image téléchargée ✓");
      onShared?.();
    } catch {
      onToast("Impossible de générer l'image — réessaie.");
    } finally {
      setIsSharing(false);
    }
  }

  return (
    <>
      {/* Le choix du thème : les fonds en vignettes, dernier choix mémorisé. */}
      <div role="radiogroup" aria-label="Thème de la carte" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
        {SHARE_THEMES.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            role="radio"
            aria-checked={candidate.id === theme.id}
            aria-label={`Thème ${candidate.label}`}
            onClick={() => chooseTheme(candidate)}
            className={`shrink-0 overflow-hidden rounded-lg border transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan ${
              candidate.id === theme.id ? "border-cyan ring-2 ring-cyan" : "border-line opacity-70"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- vignette locale, pas d'optimisation utile */}
            <img src={candidate.background} alt="" loading="lazy" className="h-24 w-16 object-cover" />
          </button>
        ))}
      </div>
      <p className="mb-2 text-center text-xs text-ink3">{theme.label}</p>

      {/* L'aperçu EST le rendu : ce canvas est l'image qui partira. */}
      <div className="relative">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Aperçu de la carte — thème ${theme.label}`}
          className="w-full rounded-xl border border-line bg-card2"
          style={{ aspectRatio: "2 / 3" }}
        />
        {isRendering && (
          <div className="absolute inset-0 grid place-items-center rounded-xl bg-black/40 text-sm font-bold text-ink">
            Préparation…
          </div>
        )}
      </div>
      {renderError && (
        <p role="alert" className="mt-2 text-sm text-red">
          Impossible de préparer la carte — vérifie ta connexion et réessaie.
        </p>
      )}

      <Button block onClick={shareImage} disabled={isRendering || isSharing || renderError} className="mt-3">
        <Share2 aria-hidden className="size-5" />
        Partager l&apos;image
      </Button>
    </>
  );
}
