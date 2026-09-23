"use client";

import { useCallback, useState, useTransition, type Ref } from "react";
import { Button } from "@/components/ui/button";
import { NETWORK_ERROR_MESSAGE } from "@/lib/books/errors";
import { finishReadingForBook, startReadingForBook, type JournalActionResult } from "@/lib/books/journal-actions";
import { localToday } from "@/lib/dates";
import { burstConfetti } from "@/components/ui/confetti";

/**
 * Les gestes de livre partagés — un seul exemplaire de chaque, consommé par le
 * Journal, la Pile et la Biblio « Tous » (design-specs §3 : « Je commence » et
 * retrait/soft-delete étaient dupliqués sur 3 écrans → composants uniques).
 * Réutilisables par le scan à terme ; c'est pourquoi ils vivent ici, hors de
 * `components/scan/`.
 *
 * La plomberie commune (transition + capture d'erreur réseau) est le hook
 * `useBookGestures` : la vue tient l'unique `ErrorAlert` et l'état de pending,
 * les composants de geste ne font que déclencher leur action.
 *
 * Fluidité #331 (item 3) — deux règles :
 *  - le pending est INDEXÉ PAR LIGNE (`pendingKey`) : un tap ne grise plus les
 *    500 boutons de la page, seule la ligne touchée attend ;
 *  - l'OPTIMISME est la règle : `onStart` s'exécute au tap, DANS la transition
 *    (les `useOptimistic` de la vue s'y posent, les confettis y partent) ;
 *    `onFailure` reçoit le message pour annuler la célébration près du geste
 *    (l'ErrorAlert de la vue, lui, reste rempli — il est loin du doigt).
 */

/** Le résultat d'un geste, ou le message réseau si le serveur est injoignable. */
type BookActionResult = JournalActionResult;

export type GestureHooks = {
  /** Au tap, dans la transition : état optimiste, confettis, toast. */
  onStart?: () => void;
  /** Le serveur a confirmé. */
  onSuccess?: () => void;
  /** Le serveur a refusé (ou est injoignable) : de quoi annuler la célébration. */
  onFailure?: (message: string) => void;
};

export type RunGesture = (pendingKey: string, action: () => Promise<BookActionResult>, hooks?: GestureHooks) => void;

const NO_PENDING: ReadonlySet<string> = new Set();

export function useBookGestures() {
  const [error, setError] = useState<string | null>(null);
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(NO_PENDING);
  const [, startTransition] = useTransition();

  const run = useCallback<RunGesture>((pendingKey, action, hooks) => {
    setError(null);
    setPendingKeys((previous) => new Set(previous).add(pendingKey));
    startTransition(async () => {
      // Avant le premier `await` : c'est ici que la vue pose ses états
      // optimistes (React exige une transition ouverte).
      hooks?.onStart?.();
      try {
        const result = await action();
        if (!result.ok) {
          setError(result.error);
          hooks?.onFailure?.(result.error);
        } else {
          hooks?.onSuccess?.();
        }
      } catch {
        // Serveur injoignable (réseau coupé) : la promesse de la Server Action
        // rejette — sans ce catch, le geste échouerait en silence.
        setError(NETWORK_ERROR_MESSAGE);
        hooks?.onFailure?.(NETWORK_ERROR_MESSAGE);
      } finally {
        setPendingKeys((previous) => {
          const next = new Set(previous);
          next.delete(pendingKey);
          return next;
        });
      }
    });
  }, []);

  const isPendingFor = useCallback((pendingKey: string) => pendingKeys.has(pendingKey), [pendingKeys]);

  return { run, isPendingFor, hasPending: pendingKeys.size > 0, error, setError };
}

/** Le centre d'un bouton AU TAP — après, il a pu disparaître et son rect ne vaudrait plus rien. */
export function buttonCenter(button: HTMLElement): { x: number; y: number } {
  const rect = button.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * « Terminé ✓ » — LE geste des points, désormais partout où le livre est
 * visible (#144) : Pile et Biblio, plus seulement le Journal. Un tap sec,
 * comme au Journal (la note et l'avis s'ajoutent après, via « Modifier » —
 * le Journal reste la gestion fine). Confettis AU TAP (#73, puis #331 : la
 * célébration appartient au geste, pas à l'aller-retour serveur).
 */
export function FinishReadingButton({
  bookId,
  run,
  isPending,
  onStart,
}: {
  bookId: string;
  run: RunGesture;
  isPending: boolean;
  /** Ce que la vue pose en plus au tap (état optimiste, toast). */
  onStart?: () => void;
}) {
  return (
    <Button
      type="button"
      variant="done"
      disabled={isPending}
      onClick={(event) => {
        const origin = buttonCenter(event.currentTarget);
        run(bookId, () => finishReadingForBook(bookId, localToday()), {
          onStart: () => {
            burstConfetti(origin);
            onStart?.();
          },
        });
      }}
    >
      Terminé ✓
    </Button>
  );
}

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
  ref,
}: {
  bookId: string;
  run: RunGesture;
  isPending: boolean;
  label?: string;
  block?: boolean;
  /** Pour poser le focus dessus (la roulette #262 le fait à la révélation). */
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="grad"
      block={block}
      disabled={isPending}
      onClick={() => run(bookId, () => startReadingForBook(bookId, localToday()))}
    >
      {label}
    </Button>
  );
}

/**
 * Le geste retrait/soft-delete — un seul composant pour « Supprimer » (journal),
 * « Retirer » (biblio) et « Je ne l'ai pas acheté » (pile) : mêmes réserves de
 * réversibilité, même plomberie, seule l'action et l'éventuelle confirmation
 * changent.
 *
 * Deux tons :
 * - `danger` : la variante `danger` de `Button` (#84) — LE style destructif
 *   unique, partagé avec la déconnexion. Plus de rouge posé ici.
 * - `muted` : lien souligné discret `--ink3` (« Je ne l'ai pas acheté »,
 *   réversible) — volontairement en retrait, jamais un bouton.
 *
 * `confirm` : appelée avant l'action ; si elle renvoie `false`, on annule. Sans
 * elle, l'action part directement (cas de l'annulation d'achat, réversible).
 */
export function RemoveButton({
  label,
  pendingKey,
  action,
  run,
  isPending,
  confirm,
  tone = "danger",
  className = "",
}: {
  label: string;
  /** La ligne qui attend (livre ou lecture) — celle-là seule est désactivée. */
  pendingKey: string;
  action: () => Promise<BookActionResult>;
  run: RunGesture;
  isPending: boolean;
  confirm?: () => boolean;
  tone?: "danger" | "muted";
  className?: string;
}) {
  const handleClick = () => {
    if (!confirm || confirm()) run(pendingKey, action);
  };
  if (tone === "muted") {
    return (
      <button
        type="button"
        disabled={isPending}
        onClick={handleClick}
        className={`text-sm underline underline-offset-2 disabled:opacity-40 text-ink3 ${className}`}
      >
        {label}
      </button>
    );
  }
  return (
    <Button type="button" variant="danger" disabled={isPending} onClick={handleClick} className={className}>
      {label}
    </Button>
  );
}
