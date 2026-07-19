"use server";

import { revalidatePath } from "next/cache";
import { coverPhotoPath, COVERS_BUCKET } from "@/lib/books/cover-photo";
import { GENERIC_ERROR_MESSAGE } from "@/lib/books/errors";
import { getSessionOrError } from "@/lib/supabase/server";

/**
 * L'enregistrement d'une photo de couverture (specs §5.4, issue #33). Le
 * client a déjà uploadé le WebP dans le bucket (client session, RLS par
 * dossier) — ici on vérifie et on pose l'URL. Règle du 19/07/2026, gardée
 * CÔTÉ SERVEUR : la photo est le filet ultime — un livre qui a déjà une
 * couverture n'est jamais écrasé.
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
  if (book.cover_url !== null) {
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

  const { data: publicUrl } = session.supabase.storage.from(COVERS_BUCKET).getPublicUrl(path);
  // Le filtre `cover_url is null` re-vérifie la règle du filet ultime au
  // moment de l'écriture (anti-course) — et le count le dit franchement.
  const { error: updateError, count } = await session.supabase
    .from("books")
    .update({ cover_url: publicUrl.publicUrl }, { count: "exact" })
    .eq("id", bookId)
    .eq("user_id", session.user.id)
    .is("cover_url", null);
  if (updateError) {
    console.error("[covers] recordCoverPhoto:", updateError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!count) {
    return { ok: false, error: "Ce livre a déjà une couverture — la photo est le dernier recours." };
  }

  revalidatePath("/journal");
  revalidatePath("/pal");
  return { ok: true };
}
