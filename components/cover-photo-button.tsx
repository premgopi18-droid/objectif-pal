"use client";

import { useRef, useState } from "react";
import { ErrorAlert } from "@/components/error-alert";
import { recordCoverPhoto } from "@/lib/books/cover-actions";
import { coverPhotoPath, COVERS_BUCKET, fileToWebpBlob } from "@/lib/books/cover-photo";
import { NETWORK_ERROR_MESSAGE } from "@/lib/books/errors";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

/**
 * « Photographier la couverture » — le filet ultime (specs §5.4, issues #33
 * et #47). Affiché pour un livre sans couverture (mode `add`) ou dont la
 * couverture est une photo maison à reprendre (mode `retake`) — le serveur
 * re-vérifie. Photo OU import galerie (choix natif du navigateur) → WebP
 * compressé → upload Storage (client session, RLS par dossier) →
 * books.cover_url.
 */

type CoverPhotoButtonProps = {
  bookId: string;
  /** `retake` : le livre a déjà une photo maison, on la remplace (#47). */
  mode?: "add" | "retake";
};

export function CoverPhotoButton({ bookId, mode = "add" }: CoverPhotoButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setIsUploading(true);
    setError(null);
    try {
      const blob = await fileToWebpBlob(file);
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
        .upload(coverPhotoPath(user.id, bookId), blob, { upsert: true, contentType: "image/webp" });
      if (uploadError) {
        console.error("[covers] upload:", uploadError.message);
        setError("L'envoi de la photo a échoué — réessaie.");
        return;
      }
      const result = await recordCoverPhoto(bookId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setIsDone(true);
    } catch {
      // Conversion impossible ou serveur injoignable : jamais d'échec muet.
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setIsUploading(false);
    }
  }

  if (isDone) {
    return (
      <p className="text-sm font-medium text-green-500">
        {mode === "retake" ? "Couverture remplacée ✓" : "Couverture ajoutée ✓"}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Pas d'attribut `capture` : le navigateur propose nativement
          « Prendre une photo / Photothèque » — l'import galerie gratuit (#47). */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // La même photo doit pouvoir être re-choisie après une erreur.
          event.target.value = "";
          if (file) handleFile(file);
        }}
      />
      <button
        type="button"
        disabled={isUploading}
        onClick={() => inputRef.current?.click()}
        className="rounded-full border border-foreground/20 px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {isUploading ? "Envoi de la photo…" : mode === "retake" ? "📷 Reprendre la photo" : "📷 Photographier la couverture"}
      </button>
      {error && <ErrorAlert message={error} />}
    </div>
  );
}
