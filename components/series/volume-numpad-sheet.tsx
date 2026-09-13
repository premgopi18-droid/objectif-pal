"use client";

import { useEffect, useRef, useState } from "react";
import { ErrorAlert } from "@/components/error-alert";
import { Button } from "@/components/ui/button";

/**
 * « Quel tome est-ce ? » (lot B, §4.17 geste 2) : un tome lu sans numéro rend
 * la progression muette ; un tap sur le pavé règle ça. Les numéros déjà pris
 * sont désactivés ; « Autre… » ouvre un champ libre pour les grands numéros.
 * Patron des feuilles maison : dialog, fond cliquable, Échap, focus au CTA.
 */
const PAD_MINIMUM = 10;

export function VolumeNumpadSheet({
  bookTitle,
  takenNumbers,
  gridMax,
  isPending,
  errorMessage,
  onPick,
  onClose,
}: {
  bookTitle: string;
  takenNumbers: ReadonlySet<number>;
  gridMax: number;
  isPending: boolean;
  errorMessage: string | null;
  onPick: (rawNumber: string) => void;
  onClose: () => void;
}) {
  const [customNumber, setCustomNumber] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const firstRef = useRef<HTMLButtonElement>(null);
  const padSize = Math.max(PAD_MINIMUM, gridMax);

  useEffect(() => {
    firstRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Quel tome est-ce ?"
      className="animate-[fade-in_240ms_ease] fixed inset-0 z-[60] flex items-end bg-black/60"
      onClick={onClose}
    >
      <div
        className="animate-[sheet-in_280ms_cubic-bezier(0.32,0.72,0.24,1)] w-full rounded-t-2xl border-t border-line bg-card p-4 pb-8"
        onClick={(event) => event.stopPropagation()}
      >
        <div aria-hidden className="mx-auto h-1 w-10 rounded-full bg-line" />
        <h2 className="mt-3 text-base font-black text-ink">Quel tome est-ce ?</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink2">
          <b className="font-semibold text-ink">« {bookTitle} »</b> n&apos;a pas de numéro — la BnF ne le fournit pas
          toujours. Un tap suffit.
        </p>
        {errorMessage !== null && (
          <div className="mt-3">
            <ErrorAlert message={errorMessage} />
          </div>
        )}
        <div role="group" aria-label="Numéro du tome" className="mt-4 grid grid-cols-5 gap-2">
          {Array.from({ length: padSize }, (_, index) => index + 1).map((number, index) => {
            const taken = takenNumbers.has(number);
            return (
              <button
                key={number}
                ref={index === 0 ? firstRef : undefined}
                type="button"
                disabled={taken || isPending}
                aria-label={taken ? `Tome ${number}, déjà attribué` : `Tome ${number}`}
                onClick={() => onPick(String(number))}
                className="min-h-11 rounded-xl border border-line bg-card2 text-sm font-bold text-ink tabular-nums transition active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan disabled:opacity-35"
              >
                {number}
              </button>
            );
          })}
        </div>
        {showCustom ? (
          <form
            className="mt-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (customNumber.trim()) onPick(customNumber);
            }}
          >
            <input
              autoFocus
              inputMode="numeric"
              value={customNumber}
              onChange={(event) => setCustomNumber(event.target.value)}
              aria-label="Autre numéro de tome"
              placeholder="ex. 42"
              className="min-w-0 flex-1 rounded-xl border border-line bg-card2 px-3 py-2.5 text-sm text-ink placeholder:text-ink3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
            />
            <Button type="submit" variant="grad" disabled={isPending || !customNumber.trim()}>
              Valider
            </Button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setShowCustom(true)}
            disabled={isPending}
            className="mt-3 text-sm text-ink2 underline underline-offset-2 disabled:opacity-50"
          >
            Autre numéro…
          </button>
        )}
      </div>
    </div>
  );
}
