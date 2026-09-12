"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BookCover } from "@/components/book-cover";
import { ErrorAlert } from "@/components/error-alert";
import { Button } from "@/components/ui/button";
import { recordCoverPhoto, resetCoverToAutomatic, type CoverActionResult } from "@/lib/books/cover-actions";
import { coverPhotoPath, COVERS_BUCKET, fileToWebpBlob } from "@/lib/books/cover-photo";
import { NETWORK_ERROR_MESSAGE } from "@/lib/books/errors";
import { deriveCoverSheetState } from "@/lib/covers/sheet-state";

/**
 * La feuille « Changer la couverture » (#275, epic #274) — LE lieu unique du
 * choix : couverture actuelle et son origine, photo ou import galerie, et
 * « Revenir à l'automatique » quand un choix existe. Le lot B y ajoutera les
 * candidates des sources.
 *
 * Un seul exemplaire monté par écran, recyclé pour tous les livres (motif
 * `category-drawer`) ; patron de dialogue maison (fond cliquable, Échap,
 * animations sous `prefers-reduced-motion`, cf. `SeriesAlignSheet`).
 *
 * Deux inputs, deux gestes DÉTERMINISTES sur tous les OS (#50) : un input
 * `capture` pour la caméra, un input nu pour la galerie — les navigateurs
 * sont incohérents sans `capture` (Chrome Android ouvre les fichiers SANS
 * option caméra, vécu).
 */

export type CoverSheetBook = {
  bookId: string;
  title: string;
  coverUrl: string | null;
  coverChosenAt: string | null;
};

type CoverChooserSheetProps = {
  book: CoverSheetBook | null;
  onClose: () => void;
  /** La couverture a changé : le parent met sa liste à jour (la vignette suit tout de suite). */
  onChanged: (bookId: string, cover: { coverUrl: string | null; coverChosenAt: string | null }) => void;
};

export function CoverChooserSheet({ book, onClose, onChanged }: CoverChooserSheetProps) {
  if (!book) return null;
  // `key` sur le livre : ré-ouvrir sur un autre livre remonte un corps neuf
  // (erreur, confirmation, envoi repartent propres) — sans effet ni setState.
  return <SheetBody key={book.bookId} book={book} onClose={onClose} onChanged={onChanged} />;
}

function SheetBody({ book, onClose, onChanged }: CoverChooserSheetProps & { book: CoverSheetBook }) {
  const router = useRouter();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "reset" | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Échap ferme (sauf pendant un envoi : on ne laisse pas un upload orphelin).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && busy === null) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const state = deriveCoverSheetState({ coverUrl: book.coverUrl, coverChosenAt: book.coverChosenAt });

  const applied = (result: CoverActionResult, chosenAt: string | null) => {
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChanged(book.bookId, { coverUrl: result.coverUrl, coverChosenAt: chosenAt });
    // Les Server Components (Journal, Bilan) se resynchronisent ; la liste du
    // parent, elle, a déjà bougé via onChanged.
    router.refresh();
  };

  async function handleFile(file: File) {
    setBusy("upload");
    setError(null);
    try {
      const blob = await fileToWebpBlob(file);
      // Import DYNAMIQUE (#123) : le client Supabase (63 KB gz) ne sert qu'à
      // l'upload — il ne se charge qu'au geste.
      const { createBrowserSupabaseClient } = await import("@/lib/supabase/browser");
      const supabase = createBrowserSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Session expirée — reconnecte-toi.");
        return;
      }
      const { error: uploadError } = await supabase.storage
        .from(COVERS_BUCKET)
        .upload(coverPhotoPath(user.id, book.bookId), blob, { upsert: true, contentType: "image/webp" });
      if (uploadError) {
        console.error("[covers] upload:", uploadError.message);
        setError("L'envoi de la photo a échoué — réessaie.");
        return;
      }
      applied(await recordCoverPhoto(book.bookId), new Date().toISOString());
    } catch {
      // Conversion impossible ou serveur injoignable : jamais d'échec muet.
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setBusy(null);
    }
  }

  async function handleReset() {
    setBusy("reset");
    setError(null);
    try {
      applied(await resetCoverToAutomatic(book.bookId), null);
      setConfirmReset(false);
    } catch {
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setBusy(null);
    }
  }

  const onFileChosen = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // La même photo doit pouvoir être re-choisie après une erreur.
    event.target.value = "";
    if (file) handleFile(file);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Changer la couverture de ${book.title}`}
      className="animate-[fade-in_240ms_ease] fixed inset-0 z-50 flex items-end bg-black/60"
      onClick={() => busy === null && onClose()}
    >
      <div
        className="animate-[sheet-in_280ms_cubic-bezier(0.32,0.72,0.24,1)] max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border-t border-line bg-card p-4 pb-8"
        onClick={(event) => event.stopPropagation()}
      >
        <div aria-hidden className="mx-auto h-1 w-10 rounded-full bg-line" />
        <h2 className="mt-3 text-base font-black text-ink">Changer la couverture</h2>
        <p className="mt-0.5 truncate text-sm text-ink2">{book.title}</p>

        <div className="mt-4 flex items-center gap-4">
          <BookCover coverUrl={book.coverUrl} size="large" title={book.title} bookId={book.bookId} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">{state.label}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink3">
              {state.origin === "none"
                ? "Aucune source n'a d'image pour ce livre : prends-le en photo, il est peut-être sous ta main."
                : state.origin === "automatic"
                  ? "Posée par l'app. Remplace-la par ta photo : elle ne sera plus touchée."
                  : "Elle est à toi : l'app ne la remplacera plus jamais toute seule."}
            </p>
          </div>
        </div>

        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFileChosen} />
        <input ref={galleryInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChosen} />

        {error && (
          <div className="mt-3">
            <ErrorAlert message={error} />
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2">
          {busy === "upload" ? (
            <p className="py-2 text-center text-sm text-ink2">Envoi de la photo…</p>
          ) : (
            <div className="flex gap-2">
              <Button type="button" variant="ghost" className="flex-1" disabled={busy !== null} onClick={() => cameraInputRef.current?.click()}>
                📷 Prendre une photo
              </Button>
              <Button type="button" variant="ghost" className="flex-1" disabled={busy !== null} onClick={() => galleryInputRef.current?.click()}>
                🖼️ Importer une image
              </Button>
            </div>
          )}

          {state.canReset &&
            (confirmReset ? (
              <div className="flex flex-col gap-2 rounded-xl border border-line bg-card2 p-3">
                <p className="text-xs text-ink2">
                  L&apos;app reprend la main : elle cherchera une couverture chez ses sources et posera ce qu&apos;elle trouve — peut-être rien.
                </p>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" className="flex-1" disabled={busy !== null} onClick={handleReset}>
                    {busy === "reset" ? "Recherche…" : "Oui, revenir à l'automatique"}
                  </Button>
                  <button type="button" disabled={busy !== null} onClick={() => setConfirmReset(false)} className="px-3 text-sm text-ink3">
                    Garder
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => setConfirmReset(true)}
                className="py-2 text-sm text-ink3 underline underline-offset-2 disabled:opacity-50"
              >
                Revenir à l&apos;automatique
              </button>
            ))}

          <Button type="button" variant="ghost" block disabled={busy !== null} onClick={onClose}>
            Fermer
          </Button>
        </div>
      </div>
    </div>
  );
}
