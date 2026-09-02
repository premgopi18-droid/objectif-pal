"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquareText, Share2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deriveShareCardData } from "@/lib/share/card-data";
import { renderShareCard, shareCardBlob } from "@/lib/share/render-card";
import { SHARE_THEMES, type ShareTheme } from "@/lib/share/themes";
import type { MonthlyReport } from "@/lib/scoring/types";

/**
 * La feuille de partage du bilan (specs §4.15, issue #263) : Texte (le
 * conducteur, inchangé) ou Image (la carte). L'image se dessine SUR L'APPAREIL
 * au moment du choix — rien ne part sur un serveur, fermer la feuille sans
 * partager ne laisse aucune trace.
 *
 * Le thème choisi est mémorisé (localStorage, best effort §conventions : un
 * échec de stockage ne casse jamais le geste). Partage natif de fichier quand
 * la plateforme sait (`navigator.canShare({ files })`), repli téléchargement
 * sinon — un échec muet est interdit sur le geste-livrable.
 */

const LAST_THEME_STORAGE_KEY = "objectif-pal:share-card-theme";

function initialTheme(): ShareTheme {
  try {
    const storedId = localStorage.getItem(LAST_THEME_STORAGE_KEY);
    const found = SHARE_THEMES.find((theme) => theme.id === storedId);
    if (found) return found;
  } catch {
    // Stockage indisponible (navigation privée…) : le premier thème fera l'affaire.
  }
  return SHARE_THEMES[0];
}

type ShareSheetProps = {
  report: MonthlyReport;
  displayName: string;
  avatarUrl: string | null;
  /** Le partage TEXTE existant (feuille native → repli copie) — réutilisé tel quel. */
  onShareText: () => void;
  onClose: () => void;
  onToast: (message: string) => void;
};

export function ShareSheet({ report, displayName, avatarUrl, onShareText, onClose, onToast }: ShareSheetProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [theme, setTheme] = useState<ShareTheme>(initialTheme);
  const [isRendering, setIsRendering] = useState(true);
  const [renderError, setRenderError] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  // Le rendu suit le thème choisi ; un rendu dépassé (tap rapide sur les
  // vignettes) ne doit pas écraser l'état du dernier demandé.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    let cancelled = false;
    setIsRendering(true);
    setRenderError(false);
    const data = deriveShareCardData(report, displayName);
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
  }, [theme, report, displayName, avatarUrl]);

  // Échap ferme la feuille d'où que vienne le focus — le comportement attendu
  // d'un dialogue (review #264 : un onKeyDown sur un div non focusable ne se
  // déclenchait qu'après un tap à l'intérieur).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const chooseTheme = useCallback((next: ShareTheme) => {
    setTheme(next);
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
      const file = new File([blob], `objectif-pal-bilan-${report.month}.jpg`, { type: "image/jpeg" });
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          onClose();
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
      onClose();
    } catch {
      onToast("Impossible de générer l'image — réessaie.");
    } finally {
      setIsSharing(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label="Partager mon bilan"
      onClick={onClose}
    >
      <div
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border-t border-line bg-card p-4 pb-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[17px] font-extrabold text-ink">Partager mon bilan</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="grid size-11 place-items-center rounded-xl border border-line bg-card2 text-ink2 transition active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>

        {/* Le texte d'antenne — l'usage historique, toujours à un tap. */}
        <Button
          variant="ghost"
          block
          onClick={() => {
            onShareText();
            onClose();
          }}
        >
          <MessageSquareText aria-hidden className="size-5" />
          En texte — pour le conducteur
        </Button>

        <p className="mb-2 mt-5 text-xs font-bold uppercase tracking-[0.12em] text-ink3">Ou en image</p>

        {/* Le choix du thème : les 10 fonds en vignettes, dernier choix mémorisé. */}
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
      </div>
    </div>
  );
}
