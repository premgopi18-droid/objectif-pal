"use client";

import { useRef, useState, useTransition } from "react";
import { ErrorAlert } from "@/components/error-alert";
import { Button } from "@/components/ui/button";
import { fileToWebpBlob } from "@/lib/books/cover-photo";
import { NETWORK_ERROR_MESSAGE } from "@/lib/books/errors";
import { recordAvatarPhoto, removeAvatarPhoto, updateDisplayName } from "@/lib/profile/actions";
import { AVATAR_PHOTO, AVATARS_BUCKET, avatarPath } from "@/lib/profile/avatar";
import { DISPLAY_NAME_MAX_LENGTH, normalizeDisplayName } from "@/lib/profile/display-name";

/**
 * L'édition du profil (issue #224) — pseudo et photo. La photo suit le patron
 * de la couverture maison (#33/#50) : deux gestes déterministes
 * (caméra/galerie), WebP compressé CÔTÉ CLIENT (256 px — un avatar s'affiche
 * petit et rond), upload Storage par le client session (RLS par dossier), puis
 * l'action serveur vérifie et pose l'URL. La page se rafraîchit par
 * revalidation — aucune copie d'état serveur ici.
 */

const INPUT_CLASS =
  "min-w-0 flex-1 rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink " +
  "placeholder:text-ink3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan";

type ProfileEditorProps = {
  displayName: string;
  hasAvatar: boolean;
};

export function ProfileEditor({ displayName, hasAvatar }: ProfileEditorProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [nameInput, setNameInput] = useState(displayName);
  const [isUploading, setIsUploading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const busy = isUploading || isPending;

  const runAction = (
    action: () => Promise<{ ok: true } | { ok: false; error: string }>,
    doneMessage: string,
    onSuccess?: () => void,
  ) => {
    setError(null);
    setSavedMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSavedMessage(doneMessage);
      onSuccess?.();
    });
  };

  // La comparaison se fait sur la valeur NORMALISÉE (review #225) — le module
  // est pur et isomorphe : « Léna  x » (double espace) est reconnu comme déjà
  // égal au « Léna x » sauvé, le bouton se désactive vraiment.
  const normalizedInput = normalizeDisplayName(nameInput);
  const isNameUnchanged = normalizedInput.ok && normalizedInput.value === displayName;

  async function handleFile(file: File) {
    setIsUploading(true);
    setError(null);
    setSavedMessage(null);
    try {
      const blob = await fileToWebpBlob(file, AVATAR_PHOTO);
      // Import DYNAMIQUE (#123) : le client Supabase ne sert qu'à l'upload —
      // il ne se charge qu'au geste, jamais au rendu de la page Profil.
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
        .from(AVATARS_BUCKET)
        .upload(avatarPath(user.id), blob, { upsert: true, contentType: "image/webp" });
      if (uploadError) {
        console.error("[profile] upload:", uploadError.message);
        setError("L'envoi de la photo a échoué — réessaie.");
        return;
      }
      const result = await recordAvatarPhoto();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSavedMessage("Photo de profil mise à jour ✓");
    } catch {
      // Conversion impossible ou serveur injoignable : jamais d'échec muet.
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setIsUploading(false);
    }
  }

  const onFileChosen = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // La même photo doit pouvoir être re-choisie après une erreur.
    event.target.value = "";
    if (file) handleFile(file);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Le pseudo — soumission en <form> : Entrée valide, comme partout. */}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!normalizedInput.ok) {
            setError(normalizedInput.error);
            return;
          }
          const { value } = normalizedInput;
          // Au succès, l'input se resynchronise sur la valeur normalisée
          // (review #225) : ce qui est affiché est ce qui est sauvé.
          runAction(() => updateDisplayName(value), "Pseudo enregistré ✓", () => setNameInput(value));
        }}
      >
        <input
          value={nameInput}
          onChange={(event) => {
            setNameInput(event.target.value);
            // Un « ✓ » à côté d'un texte non sauvé mentirait (review #225).
            setSavedMessage(null);
          }}
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          aria-label="Pseudo"
          placeholder="Ton pseudo"
          className={INPUT_CLASS}
        />
        <Button type="submit" variant="ghost" disabled={busy || isNameUnchanged}>
          Enregistrer
        </Button>
      </form>

      {/* Deux inputs, deux gestes DÉTERMINISTES sur tous les OS (#50) : un
          input `capture` pour la caméra, un input nu pour la galerie. */}
      <input ref={cameraInputRef} type="file" accept="image/*" capture="user" className="hidden" onChange={onFileChosen} />
      <input ref={galleryInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChosen} />
      {isUploading ? (
        <p className="py-2 text-center text-sm text-ink2">Envoi de la photo…</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" className="flex-1" disabled={busy} onClick={() => cameraInputRef.current?.click()}>
            📷 {hasAvatar ? "Changer la photo" : "Prendre une photo"}
          </Button>
          <Button type="button" variant="ghost" className="flex-1" disabled={busy} onClick={() => galleryInputRef.current?.click()}>
            🖼️ Importer une image
          </Button>
          {hasAvatar && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => runAction(removeAvatarPhoto, "Photo retirée ✓")}
            >
              Retirer la photo
            </Button>
          )}
        </div>
      )}

      {savedMessage && <p className="text-sm font-medium text-green">{savedMessage}</p>}
      {error && <ErrorAlert message={error} />}
    </div>
  );
}
