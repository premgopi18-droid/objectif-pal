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
};

export function Toast({ message, onDismiss, duration = 2200 }: ToastProps) {
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
      className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-full border border-line bg-card2 px-4.5 py-2.5 text-sm font-semibold text-ink shadow-float"
    >
      {message}
    </div>
  );
}
