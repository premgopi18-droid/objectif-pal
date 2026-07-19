"use server";

import { revalidatePath } from "next/cache";
import { coverPhotoPath, COVERS_BUCKET, isHouseCoverPhotoUrl } from "@/lib/books/cover-photo";
import { GENERIC_ERROR_MESSAGE } from "@/lib/books/errors";
import { getSessionOrError } from "@/lib/supabase/server";

/**
 * L'enregistrement d'une photo de couverture (specs §5.4, issues #33 et #47).
 * Le client a déjà uploadé le WebP dans le bucket (client session, RLS par
 * dossier) — ici on vérifie et on pose l'URL. Règle du 19/07/2026, gardée
 * CÔTÉ SERVEUR : la photo est le filet ultime — une couverture de SOURCE
 * n'est jamais écrasée ; seule une photo MAISON peut être reprise (#47).
 */

export type CoverActionResult = { ok: true } | { ok: false; error: string };

export async function recordCoverPhoto(bookId: string): Promise<CoverActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };

  const { data: book, error: readError } = await session.supabase
    .from("books")
    .select("cover_url")
    .eq("id", bookId)
    .eq("user_id", session.user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError) {
    console.error("[covers] recordCoverPhoto:", readError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!book) return { ok: false, error: "Livre introuvable." };
  // Filet ultime raffiné (#47) : une couverture de SOURCE est intouchable ;
  // une photo maison (notre bucket) peut être reprise.
  if (book.cover_url !== null && !isHouseCoverPhotoUrl(book.cover_url)) {
    return { ok: false, error: "Ce livre a déjà une couverture — la photo est le dernier recours." };
  }

  // L'objet doit exister : on ne pose jamais une URL qui 404erait dans le
  // journal. (Le chemin est déterministe : {user_id}/{book_id}.webp.)
  const path = coverPhotoPath(session.user.id, bookId);
  const { data: objects, error: listError } = await session.supabase.storage
    .from(COVERS_BUCKET)
    .list(session.user.id, { search: `${bookId}.webp`, limit: 1 });
  if (listError) {
    console.error("[covers] recordCoverPhoto:", listError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!objects || objects.length === 0) {
    return { ok: false, error: "La photo n'a pas été reçue — réessaie." };
  }

  // L'objet Storage est écrasé au MÊME chemin : le `?v=` versionne l'URL pour
  // que CDN et next/image servent la nouvelle photo, pas l'ancienne en cache.
  const { data: publicUrl } = session.supabase.storage.from(COVERS_BUCKET).getPublicUrl(path);
  const versionedUrl = `${publicUrl.publicUrl}?v=${Date.now()}`;
  // Anti-course : on n'écrit que si la couverture vaut encore EXACTEMENT ce
  // qu'on vient de lire (vide, ou la photo maison qu'on remplace) — et le
  // count dit franchement quand la course est perdue.
  let update = session.supabase
    .from("books")
    .update({ cover_url: versionedUrl }, { count: "exact" })
    .eq("id", bookId)
    .eq("user_id", session.user.id);
  update = book.cover_url === null ? update.is("cover_url", null) : update.eq("cover_url", book.cover_url);
  const { error: updateError, count } = await update;
  if (updateError) {
    console.error("[covers] recordCoverPhoto:", updateError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!count) {
    return { ok: false, error: "La couverture vient de changer — recharge et réessaie." };
  }

  revalidatePath("/journal");
  revalidatePath("/bibliotheque");
  return { ok: true };
}
