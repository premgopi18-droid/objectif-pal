"use client";

import { useEffect, useMemo } from "react";
import { MessageSquareText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardComposer } from "@/components/share/card-composer";
import { deriveShareCardData } from "@/lib/share/card-data";
import type { MonthlyReport } from "@/lib/scoring/types";

/**
 * La feuille de partage du bilan (specs §4.15, issue #263) : Texte (le
 * conducteur, inchangé) ou Image (la carte). Le rendu, les thèmes et le geste
 * de partage vivent dans le `CardComposer` (partagé avec la carte d'invité) —
 * ici ne restent que le dialogue et le choix Texte / Image.
 */

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
  // Mémoïsée : le composeur re-dessine quand `data` change d'identité.
  const cardData = useMemo(() => deriveShareCardData(report, displayName), [report, displayName]);

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

        <CardComposer
          data={cardData}
          avatarUrl={avatarUrl}
          fileName={`objectif-pal-bilan-${report.month}.jpg`}
          onToast={onToast}
          onShared={onClose}
        />
      </div>
    </div>
  );
}
