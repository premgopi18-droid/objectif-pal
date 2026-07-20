"use client";

import { useRef, useState } from "react";
import { ErrorAlert } from "@/components/error-alert";
import { Button } from "@/components/ui/button";
import { recordCoverPhoto } from "@/lib/books/cover-actions";
import { coverPhotoPath, COVERS_BUCKET, fileToWebpBlob } from "@/lib/books/cover-photo";
import { NETWORK_ERROR_MESSAGE } from "@/lib/books/errors";

/**
 * « Prendre une photo / Importer une image » — le filet ultime (specs §5.4,
 * issues #33, #47, #50). Affiché pour un livre sans couverture (mode `add`)
 * ou dont la couverture est une photo maison à reprendre (mode `retake`) —
 * le serveur re-vérifie. Deux boutons explicites (les navigateurs sont
 * incohérents sur le choix caméra/galerie, #50) → WebP compressé → upload
 * Storage (client session, RLS par dossier) → books.cover_url.
 */

type CoverPhotoButtonProps = {
  bookId: string;
  /** `retake` : le livre a déjà une photo maison, on la remplace (#47). */
  mode?: "add" | "retake";
};

export function CoverPhotoButton({ bookId, mode = "add" }: CoverPhotoButtonProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setIsUploading(true);
    setError(null);
    try {
      const blob = await fileToWebpBlob(file);
      // Import DYNAMIQUE (#123) : ce composant est monté sur le journal, la
      // Biblio et le scan, mais le client Supabase (63 KB gz) ne sert qu'à
      // l'UPLOAD — il ne se charge qu'au geste. Un échec de chargement du
      // chunk (réseau coupé) tombe dans le catch existant, jamais muet.
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
      <p className="text-sm font-medium text-green">
        {mode === "retake" ? "Couverture remplacée ✓" : "Couverture ajoutée ✓"}
      </p>
    );
  }

  const onFileChosen = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // La même photo doit pouvoir être re-choisie après une erreur.
    event.target.value = "";
    if (file) handleFile(file);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Deux inputs, deux gestes DÉTERMINISTES sur tous les OS (#50) : les
          navigateurs sont incohérents sans `capture` (Chrome Android ouvre les
          fichiers SANS option caméra, vécu) — un input `capture` pour la
          caméra, un input nu pour la galerie/les fichiers. */}
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFileChosen} />
      <input ref={galleryInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChosen} />
      {isUploading ? (
        <p className="py-2 text-center text-sm text-ink2">Envoi de la photo…</p>
      ) : (
        <div className="flex gap-2">
          <Button type="button" variant="ghost" className="flex-1" onClick={() => cameraInputRef.current?.click()}>
            📷 {mode === "retake" ? "Reprendre une photo" : "Prendre une photo"}
          </Button>
          <Button type="button" variant="ghost" className="flex-1" onClick={() => galleryInputRef.current?.click()}>
            🖼️ Importer une image
          </Button>
        </div>
      )}
      {error && <ErrorAlert message={error} />}
    </div>
  );
}
