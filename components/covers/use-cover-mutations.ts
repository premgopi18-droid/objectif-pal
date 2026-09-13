import { useState, type Dispatch, type SetStateAction } from "react";
import { recordCoverPhoto, resetCoverToAutomatic, type CoverActionResult } from "@/lib/books/cover-actions";
import { chooseCover } from "@/lib/books/cover-choice-actions";
import { uploadCoverPhoto } from "@/lib/books/cover-photo-upload";
import { NETWORK_ERROR_MESSAGE } from "@/lib/books/errors";
import type { CoverCandidate } from "@/lib/covers/candidates";
import type { CoverSheetBook } from "./cover-sheet-book";

/**
 * Les trois gestes qui CHANGENT la couverture (audit #274, sortis de
 * `cover-chooser-sheet.tsx`) : choisir une candidate, envoyer une photo,
 * revenir à l'automatique — et l'état qu'ils partagent (un seul geste à la
 * fois, erreur, succès, confirmation). Chaque succès remonte au parent par
 * `onChanged` : la vignette suit tout de suite.
 */
export type CoverBusy = "upload" | "reset" | "choose" | null;

export function useCoverMutations({
  book,
  setBook,
  onChanged,
  onChosen,
}: {
  book: CoverSheetBook;
  setBook: Dispatch<SetStateAction<CoverSheetBook>>;
  onChanged: (bookId: string, cover: { coverUrl: string | null; coverChosenAt: string | null }) => void;
  /** Une candidate choisie sort des grilles. */
  onChosen: (url: string) => void;
}) {
  const [busy, setBusy] = useState<CoverBusy>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function applyCoverResult(result: CoverActionResult, chosenAt: string | null, message: string) {
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const cover = { coverUrl: result.coverUrl, coverChosenAt: chosenAt };
    setBook((previous) => ({ ...previous, ...cover }));
    setSuccess(message);
    onChanged(book.bookId, cover);
    // Pas de router.refresh() (audit #274) : les actions font déjà
    // revalidatePath, et la réponse d'une Server Action porte le re-rendu de
    // la route courante — un refresh de plus, c'est la Biblio relue deux fois.
  }

  async function chooseCandidate(candidate: CoverCandidate) {
    setBusy("choose");
    setError(null);
    setSuccess(null);
    try {
      applyCoverResult(await chooseCover(book.bookId, candidate.url), new Date().toISOString(), "Couverture choisie ✓");
      onChosen(candidate.url);
    } catch {
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setBusy(null);
    }
  }

  async function uploadFile(file: File) {
    setBusy("upload");
    setError(null);
    setSuccess(null);
    try {
      const upload = await uploadCoverPhoto(file, book.bookId);
      if (!upload.ok) {
        setError(upload.error);
        return;
      }
      applyCoverResult(
        await recordCoverPhoto(book.bookId),
        new Date().toISOString(),
        book.coverUrl === null ? "Couverture ajoutée ✓" : "Couverture remplacée ✓",
      );
    } catch {
      // Conversion impossible ou serveur injoignable : jamais d'échec muet.
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setBusy(null);
    }
  }

  async function resetToAutomatic() {
    setBusy("reset");
    setError(null);
    setSuccess(null);
    try {
      applyCoverResult(await resetCoverToAutomatic(book.bookId), null, "L'app a repris la main ✓");
      setConfirmReset(false);
    } catch {
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setBusy(null);
    }
  }

  return { busy, error, success, confirmReset, setConfirmReset, chooseCandidate, uploadFile, resetToAutomatic };
}
