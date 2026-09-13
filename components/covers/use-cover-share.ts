import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { shareCover, unshareCover } from "@/lib/books/cover-share-actions";
import { NETWORK_ERROR_MESSAGE } from "@/lib/books/errors";
import { deriveShareState, type CoverShareState } from "@/lib/covers/share-state";
import type { CoverSheetBook, CoverSheetFacts } from "./cover-sheet-book";

/**
 * Le partage au pool (#278) vu de la feuille (audit #274, sorti de
 * `cover-chooser-sheet.tsx`) : l'état dérivé pur, la case (partager / retirer)
 * et le partage SILENCIEUX d'une couverture rapatriée à la relecture de la
 * fiche. La contribution est proposée aux autres, jamais imposée.
 */
export function useCoverShare(book: CoverSheetBook, setBook: Dispatch<SetStateAction<CoverSheetBook>>) {
  // Dérivé pur, inconnu tant que la base n'a pas répondu (`barcodeRaw` undefined).
  const share: CoverShareState | null =
    book.barcodeRaw === undefined
      ? null
      : deriveShareState({ coverUrl: book.coverUrl, barcodeRaw: book.barcodeRaw, sharedSourceCoverUrl: book.sharedSourceCoverUrl ?? null });
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  async function toggleShare(next: boolean) {
    setShareBusy(true);
    setShareError(null);
    try {
      const result = next ? await shareCover(book.bookId) : await unshareCover(book.bookId);
      if (!result.ok) {
        setShareError(result.error);
        return;
      }
      // La contribution reflète désormais (ou plus) la couverture actuelle.
      setBook((previous) => ({ ...previous, sharedSourceCoverUrl: result.shared ? previous.coverUrl : null }));
    } catch {
      setShareError(NETWORK_ERROR_MESSAGE);
    } finally {
      setShareBusy(false);
    }
  }

  /**
   * Une couverture RAPATRIÉE d'une source se partage par défaut (#278, décision
   * du 12/09) : rien de personnel dessus. La case apparaît cochée, et décocher
   * retire. Une photo, elle, attend le geste. `isCancelled` : la feuille s'est
   * refermée entre-temps, on ne touche plus à son état.
   */
  const autoShareIfDefault = useCallback(
    (bookId: string, facts: CoverSheetFacts, isCancelled: () => boolean) => {
      const shareState = deriveShareState({ coverUrl: facts.coverUrl, barcodeRaw: facts.barcodeRaw, sharedSourceCoverUrl: facts.sharedSourceCoverUrl });
      if (!(shareState.shareable && shareState.defaultChecked && !shareState.shared && !shareState.stale)) return;
      shareCover(bookId, { silent: true })
        .then((result) => {
          if (!isCancelled() && result.ok && result.shared) setBook((previous) => ({ ...previous, sharedSourceCoverUrl: previous.coverUrl }));
        })
        .catch(() => {
          // Pas grave : la case restera décochée, le geste manuel reste possible.
        });
    },
    [setBook],
  );

  return { share, shareBusy, shareError, toggleShare, autoShareIfDefault };
}
