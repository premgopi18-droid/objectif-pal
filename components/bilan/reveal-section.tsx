"use client";

import { useState, useTransition } from "react";
import { ErrorAlert } from "@/components/error-alert";
import { Button } from "@/components/ui/button";
import { revealMonth } from "@/lib/circle/actions";
import { autoRevealMonth, isAutoRevealed } from "@/lib/circle/reveal";
import { formatMonthFrench } from "@/lib/dates";
import type { Month } from "@/lib/scoring/types";

/**
 * Le reveal au cercle (#243) — « le reveal appartient à l'émission » : le
 * bouton vit sur le Bilan du mois clos, à côté du « Copier pour l'antenne »,
 * parce que c'est le même rituel : on copie, on enregistre l'émission, on
 * révèle. À SENS UNIQUE (pas de dé-reveal), avec la bascule automatique en
 * filet au 1er du mois suivant — affichée pour que rien ne surprenne.
 */

type RevealSectionProps = {
  month: Month;
  currentMonth: Month;
  /** Mes reveals MANUELS (`YYYY-MM`) — la bascule automatique se calcule ici. */
  revealedMonths: string[];
  onDone: (message: string) => void;
};

export function RevealSection({ month, currentMonth, revealedMonths, onDone }: RevealSectionProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isManuallyRevealed = revealedMonths.includes(month);
  const isVisible = isManuallyRevealed || isAutoRevealed(month, currentMonth);

  if (isVisible) {
    return (
      <p className="text-center text-sm text-ink3">
        🔓 Visible du cercle{isManuallyRevealed ? " — révélé ✓" : " (bascule automatique)"}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        type="button"
        variant="ghost"
        block
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await revealMonth(month);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            onDone(result.message ?? "Révélé au cercle ✓");
          });
        }}
      >
        🔓 Révéler <span className="capitalize">{formatMonthFrench(month)}</span> au cercle
      </Button>
      <p className="text-center text-xs text-ink3">
        Tes amis ne voient pas encore ce bilan — sinon, il sera visible automatiquement le 1ᵉʳ{" "}
        <span className="capitalize">{formatMonthFrench(autoRevealMonth(month))}</span>.
      </p>
      {error && <ErrorAlert message={error} />}
    </div>
  );
}
