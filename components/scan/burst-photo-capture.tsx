"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorAlert } from "@/components/error-alert";
import { COVERS_BUCKET, fileToWebpBlob, inboxCoverPhotoPath } from "@/lib/books/cover-photo";
import { NETWORK_ERROR_MESSAGE } from "@/lib/books/errors";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

/**
 * « Pas de code-barres → photo » DANS la boucle de rafale (#108, specs §4.13).
 *
 * Le neuvième cas du scan d'étagère : le vieux livre sans code-barres lisible —
 * précisément ceux des étagères d'avant l'app (éditions anciennes, occasions).
 * Sans ce geste, il obligeait à quitter la rafale, exactement la rupture de
 * chaîne que tout le lot C existe pour éviter.
 *
 * Pourquoi ce composant REMPLACE le scanner au lieu de s'afficher à côté : deux
 * flux caméra ne cohabitent pas. Le scanner tient un `MediaStream`
 * (`getUserMedia`) ; la capture passe par la caméra native de l'OS
 * (`<input capture>`). Les ouvrir ensemble échoue ou vole le flux — selon le
 * navigateur, ce qui est pire (ça marche sur une machine, pas sur un
 * téléphone). La rafale DÉMONTE donc le scanner avant de nous monter (son
 * cleanup libère les pistes du flux), et le remonte à notre sortie : la caméra
 * n'est jamais tenue deux fois.
 *
 * La photo n'IDENTIFIE pas le livre (pas d'OCR, §4.13) : elle sert d'identité
 * VISUELLE pour la finition, où l'utilisateur saisira les infos sous les yeux.
 */
export function BurstPhotoCapture({
  onUploaded,
  onCancel,
}: {
  /** La photo est dans le bucket : son URL publique, prête pour la boîte de finition. */
  onUploaded: (coverUrl: string) => void;
  /** Retour au scan sans rien capter — aucune ligne fantôme. */
  onCancel: () => void;
}) {
  // Deux inputs, deux gestes DÉTERMINISTES sur tous les OS (#50) : sans
  // `capture`, Chrome Android ouvre les fichiers sans option caméra (vécu).
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Le panneau REMPLACE le scanner : sans déplacer le focus, un lecteur d'écran
  // ne saurait pas que le contexte a changé (review #112). Le titre le reçoit
  // au montage — donc à l'entrée en mode photo — et l'annonce (`tabIndex={-1}` :
  // focusable par programme, jamais dans l'ordre de tabulation).
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  async function handleFile(file: File) {
    setIsUploading(true);
    setError(null);
    try {
      // On n'uploade jamais les plusieurs Mo du capteur : WebP compressé (#33).
      const blob = await fileToWebpBlob(file);
      const supabase = createBrowserSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Session expirée — reconnecte-toi.");
        return;
      }
      // Pas de book_id en rafale : on indexe la photo sur un id propre (#108).
      const path = inboxCoverPhotoPath(user.id, crypto.randomUUID());
      const { error: uploadError } = await supabase.storage
        .from(COVERS_BUCKET)
        .upload(path, blob, { upsert: true, contentType: "image/webp" });
      if (uploadError) {
        console.error("[covers] burst photo:", uploadError.message);
        setError("L'envoi de la photo a échoué — réessaie.");
        return;
      }
      // Bucket public : l'URL directe est stable, comme les couvertures de source.
      const { data: publicUrl } = supabase.storage.from(COVERS_BUCKET).getPublicUrl(path);
      onUploaded(publicUrl.publicUrl);
    } catch {
      // Conversion impossible ou réseau coupé : jamais d'échec muet.
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setIsUploading(false);
    }
  }

  const onFileChosen = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // La même photo doit pouvoir être re-choisie après une erreur.
    event.target.value = "";
    if (file) void handleFile(file);
  };

  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-card p-4">
      <div>
        {/* Vrai titre de niveau 2 (le <h1> est « Scan d'étagère ») : reçoit le
            focus au montage pour annoncer l'entrée en mode photo. */}
        <h2 ref={headingRef} tabIndex={-1} className="font-medium text-ink outline-none">
          Livre sans code-barres
        </h2>
        <p className="mt-0.5 text-sm text-ink2">
          Photographie la couverture : elle servira à le reconnaître dans la boîte de finition, où tu
          renseigneras ses infos.
        </p>
      </div>

      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFileChosen} />
      <input ref={galleryInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChosen} />

      {isUploading ? (
        <p className="py-2 text-center text-sm text-ink2">Envoi de la photo…</p>
      ) : (
        <>
          <div className="flex gap-2">
            <Button type="button" variant="grad" className="flex-1" onClick={() => cameraInputRef.current?.click()}>
              📷 Prendre une photo
            </Button>
            <Button type="button" variant="ghost" className="flex-1" onClick={() => galleryInputRef.current?.click()}>
              🖼️ Importer
            </Button>
          </div>
          {/* Annuler ramène au scan actif : si la caméra native est refermée
              sans photo, on retombe ici, pas dans un écran mort (critère #108). */}
          <Button type="button" variant="ghost" onClick={onCancel}>
            Annuler — revenir au scan
          </Button>
        </>
      )}
      {error && <ErrorAlert message={error} />}
    </div>
  );
}
