"use client";

import { useCallback, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { NETWORK_ERROR_MESSAGE } from "@/lib/books/errors";
import { startReadingForBook, type JournalActionResult } from "@/lib/books/journal-actions";
import { localToday } from "@/lib/dates";

/**
 * Les gestes de livre partagés — un seul exemplaire de chaque, consommé par le
 * Journal, la Pile et la Biblio « Tous » (design-specs §3 : « Je commence » et
 * retrait/soft-delete étaient dupliqués sur 3 écrans → composants uniques).
 * Réutilisables par le scan à terme ; c'est pourquoi ils vivent ici, hors de
 * `components/scan/`.
 *
 * La plomberie commune (transition + capture d'erreur réseau) est le hook
 * `useBookGestures` : la vue tient l'unique `ErrorAlert` et l'état `isPending`,
 * les composants de geste ne font que déclencher leur action.
 */

/** Le résultat d'un geste, ou le message réseau si le serveur est injoignable. */
type BookActionResult = JournalActionResult;

export function useBookGestures() {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = useCallback((action: () => Promise<BookActionResult>) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) setError(result.error);
      } catch {
        // Serveur injoignable (réseau coupé) : la promesse de la Server Action
        // rejette — sans ce catch, le geste échouerait en silence.
        setError(NETWORK_ERROR_MESSAGE);
      }
    });
  }, []);

  return { run, isPending, error, setError };
}

type RunGesture = (action: () => Promise<BookActionResult>) => void;

/**
 * « Je commence » — le CTA en dégradé qui démarre une lecture pour un livre
 * possédé (specs §4.6). Un seul composant, partagé Pile/Biblio.
 */
export function StartReadingButton({
  bookId,
  run,
  isPending,
  label = "Je commence",
  block = false,
}: {
  bookId: string;
  run: RunGesture;
  isPending: boolean;
  label?: string;
  block?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="grad"
      block={block}
      disabled={isPending}
      onClick={() => run(() => startReadingForBook(bookId, localToday()))}
    >
      {label}
    </Button>
  );
}

/**
 * Le geste retrait/soft-delete — un seul composant pour « Supprimer » (journal),
 * « Retirer » (biblio) et « Je ne l'ai pas acheté » (pile) : mêmes réserves de
 * réversibilité, même plomberie, seule l'action et l'éventuelle confirmation
 * changent. Rendu en lien souligné discret (jamais un CTA).
 *
 * `confirm` : appelée avant l'action ; si elle renvoie `false`, on annule. Sans
 * elle, l'action part directement (cas de l'annulation d'achat, réversible).
 */
export function RemoveButton({
  label,
  action,
  run,
  isPending,
  confirm,
  tone = "danger",
  className = "",
}: {
  label: string;
  action: () => Promise<BookActionResult>;
  run: RunGesture;
  isPending: boolean;
  confirm?: () => boolean;
  tone?: "danger" | "muted";
  className?: string;
}) {
  const toneClass = tone === "danger" ? "text-red" : "text-ink3";
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (!confirm || confirm()) run(action);
      }}
      className={`text-sm underline underline-offset-2 disabled:opacity-40 ${toneClass} ${className}`}
    >
      {label}
    </button>
  );
}
