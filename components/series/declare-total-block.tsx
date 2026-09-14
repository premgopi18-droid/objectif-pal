"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { knownMaxHint, suggestedTotal } from "@/lib/series/copy";
import type { SeriesProgress } from "@/lib/series/derive-series";

/**
 * « Combien de tomes fait cette série ? » (lot B, §4.17 geste 1) : un stepper
 * pré-rempli par le plus grand plancher connu — GCD pour la VO, la BnF par
 * édition pour la VF (#299) — jamais une vérité (la mention dessous le dit),
 * sinon par le plus grand possédé. Deux sorties : « C'est le
 * total » ou « Parution en cours ». Le fait part dans le référentiel partagé,
 * avec l'auteur.
 */
export function DeclareTotalBlock({
  progress,
  isPending,
  onDeclareTotal,
  onDeclareOngoing,
  onCancel,
}: {
  progress: SeriesProgress;
  isPending: boolean;
  onDeclareTotal: (total: number) => void;
  onDeclareOngoing: () => void;
  /** Présent quand le bloc est ouvert par « Modifier » sur un total déjà déclaré. */
  onCancel?: () => void;
}) {
  const floor = Math.max(1, ...progress.readNumbers, ...progress.pileNumbers);
  const [draft, setDraft] = useState(() => suggestedTotal(progress));

  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-card2 p-3">
      <h4 className="text-sm font-bold text-ink">Combien de tomes fait cette série ?</h4>
      <p className="text-xs leading-relaxed text-ink2">
        Un chiffre suffit pour suivre ta progression — corrigeable à tout moment. {knownMaxHint(progress.knownMax)}
      </p>
      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          aria-label="Un tome de moins"
          disabled={isPending || draft <= floor}
          onClick={() => setDraft((value) => Math.max(floor, value - 1))}
          className="min-h-11 min-w-11 rounded-full border border-line bg-card text-xl font-bold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan disabled:opacity-35"
        >
          −
        </button>
        <output aria-live="polite" className="min-w-12 text-center text-3xl font-black tabular-nums text-ink">
          {draft}
        </output>
        <button
          type="button"
          aria-label="Un tome de plus"
          disabled={isPending}
          onClick={() => setDraft((value) => value + 1)}
          className="min-h-11 min-w-11 rounded-full border border-line bg-card text-xl font-bold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan disabled:opacity-35"
        >
          +
        </button>
      </div>
      <div className="flex flex-col gap-2">
        <Button type="button" variant="grad" block disabled={isPending} onClick={() => onDeclareTotal(draft)}>
          ✓ C&apos;est le total
        </Button>
        <Button type="button" variant="ghost" block disabled={isPending} onClick={onDeclareOngoing}>
          ♾️ Parution en cours
        </Button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={isPending} className="py-1 text-sm text-ink3 disabled:opacity-50">
            Annuler
          </button>
        )}
      </div>
    </div>
  );
}
