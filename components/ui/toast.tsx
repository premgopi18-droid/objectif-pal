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
      className="fixed bottom-24 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-full border border-line bg-card2 px-4.5 py-2.5 text-sm font-semibold text-ink shadow-float"
    >
      <span className="truncate">{message}</span>
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
