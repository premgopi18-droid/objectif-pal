import { coverPhotoPath, COVERS_BUCKET, fileToWebpBlob } from "@/lib/books/cover-photo";

/**
 * L'envoi d'une photo de couverture dans NOTRE bucket, côté client (#33, #275)
 * — sorti de la feuille à l'audit #274 : conversion WebP, session, upload.
 * Les deux refus portent le message que la feuille affiche ; une conversion
 * impossible ou un réseau coupé remontent en exception — jamais d'échec muet.
 *
 * Import DYNAMIQUE du client Supabase (#123) : 63 KB gz qui ne servent qu'à
 * l'upload — chargés au geste, pas à l'ouverture de la feuille.
 */
export type CoverPhotoUploadResult = { ok: true } | { ok: false; error: string };

export async function uploadCoverPhoto(file: File, bookId: string): Promise<CoverPhotoUploadResult> {
  const blob = await fileToWebpBlob(file);
  const { createBrowserSupabaseClient } = await import("@/lib/supabase/browser");
  const supabase = createBrowserSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Session expirée — reconnecte-toi." };
  const { error: uploadError } = await supabase.storage
    .from(COVERS_BUCKET)
    .upload(coverPhotoPath(user.id, bookId), blob, { upsert: true, contentType: "image/webp" });
  if (uploadError) {
    console.error("[covers] upload:", uploadError.message);
    return { ok: false, error: "L'envoi de la photo a échoué — réessaie." };
  }
  return { ok: true };
}
