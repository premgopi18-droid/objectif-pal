"use client";

import { useTransition } from "react";
import { CategoryPicker } from "@/components/category-picker";
import { Button } from "@/components/ui/button";
import { updateBookCategory } from "@/lib/books/library-actions";
import { NETWORK_ERROR_MESSAGE } from "@/lib/books/errors";
import type { BookCategory } from "@/lib/scoring/types";

/**
 * Le tiroir de correction de catégorie (#101 lot C).
 *
 * **Un seul exemplaire monté**, recyclé pour toutes les lignes de la liste de
 * session : c'est ce qui permet d'afficher 80 scans sans monter 80 sélecteurs.
 * La correction est volontairement possible ICI, et pas dans la confirmation
 * du scan : mettre ce choix dans la boucle l'arrêterait, et la rafale ne
 * s'arrête jamais (§4.13).
 *
 * Pourquoi la catégorie, et elle seule : **elle détermine les points** (§3).
 * Une BD classée manga, c'est un bilan d'antenne faux.
 */
export function CategoryDrawer({
  open,
  bookId,
  value,
  onClose,
  onChanged,
  onError,
}: {
  open: boolean;
  bookId: string | null;
  value: BookCategory;
  onClose: () => void;
  onChanged: (category: BookCategory) => void;
  onError: (message: string) => void;
}) {
  const [isPending, startTransition] = useTransition();

  if (!open || bookId === null) return null;

  const choose = (category: BookCategory) => {
    if (category === value) {
      onClose();
      return;
    }
    startTransition(async () => {
      try {
        const result = await updateBookCategory(bookId, category);
        if (!result.ok) {
          onError(result.error);
          onClose();
          return;
        }
        onChanged(category);
      } catch {
        // Serveur injoignable : la promesse de la Server Action rejette — sans
        // ce catch, la correction échouerait en silence.
        onError(NETWORK_ERROR_MESSAGE);
        onClose();
      }
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Corriger la catégorie"
      className="fixed inset-0 z-50 flex items-end bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-2xl border-t border-line bg-card p-4 pb-8"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-sm font-medium text-ink2">Catégorie</h2>
        <p className="mt-0.5 mb-3 text-xs text-ink3">
          C&apos;est elle qui détermine les points — un tap suffit à la corriger.
        </p>
        <fieldset disabled={isPending}>
          <CategoryPicker value={value} onChange={choose} />
        </fieldset>
        <Button type="button" variant="ghost" block className="mt-4" onClick={onClose}>
          Fermer
        </Button>
      </div>
    </div>
  );
}
