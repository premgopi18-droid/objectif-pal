"use client";

import { useEffect } from "react";

/**
 * Le toast (design-specs §4) : pill flottante en bas d'écran (confirmation de
 * copie, lecture terminée). S'auto-efface après `duration`. Interactif (timer)
 * → "use client".
 *
 * Contrôlé : `message` vide/null = rien à l'écran. `role="status"` +
 * `aria-live="polite"` pour que les lecteurs d'écran l'annoncent sans voler le focus.
 */

type ToastProps = {
  message: string | null;
  onDismiss: () => void;
  /** Durée d'affichage en ms avant auto-effacement. */
  duration?: number;
  /**
   * L'action du toast (fluidité #332, item 6) : UN bouton, ex. « Changer la
   * couverture » après un scan enregistré — le toast remplace l'écran de
   * confirmation, il doit porter le geste qui y vivait.
   */
  action?: { label: string; onClick: () => void };
};

export function Toast({ message, onDismiss, duration = 2200, action }: ToastProps) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [message, duration, onDismiss]);

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-24 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 border border-line bg-card2 px-4.5 py-2.5 text-sm font-semibold text-ink shadow-float ${
        // Avec une action, le toast porte une phrase : deux lignes valent mieux
        // qu'une coupure (review #346). Sans, la pill d'une ligne historique.
        action ? "rounded-2xl" : "whitespace-nowrap rounded-full"
      }`}
    >
      <span className={action ? "min-w-0" : "truncate"}>{message}</span>
      {action && (
        <button
          type="button"
          onClick={() => {
            onDismiss();
            action.onClick();
          }}
          className="shrink-0 whitespace-nowrap rounded-full bg-grad px-3 py-1 text-xs font-bold text-bg0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
