"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { GENERIC_ERROR_MESSAGE } from "@/lib/books/errors";
import { coverStoragePathFromUrl, COVERS_BUCKET, isOwnHouseCoverPhotoUrl, sharedCoverPath } from "@/lib/books/cover-photo";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionOrError } from "@/lib/supabase/server";

/**
 * Le pool partagé de couvertures (#278, lot D) — partager SA couverture pour
 * que les autres la voient proposée sur le même code-barres.
 *
 * La copie part dans le dossier COMMUN `shared/{barcode}/{uuid}.webp` par le
 * client service role (aucune policy client sur ce dossier) : elle survit à
 * la suppression du compte du contributeur. La ligne `cover_contributions`,
 * elle, s'écrit avec le client SESSION (RLS : les siennes seulement).
 */

export type CoverShareResult = { ok: true; shared: boolean } | { ok: false; error: string };

export async function shareCover(bookId: string): Promise<CoverShareResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };
  const { supabase, user } = session;

  const { data: book, error } = await supabase
    .from("books")
    .select("barcode_raw, cover_url")
    .eq("id", bookId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    console.error("[covers] shareCover:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!book) return { ok: false, error: "Livre introuvable." };
  if (book.barcode_raw === null) return { ok: false, error: "Un livre sans code-barres ne peut pas partager sa couverture." };
  // Seul le PROPRE dossier de l'appelant se copie (#180) : jamais la photo d'un
  // autre rejouée depuis un export, jamais une URL externe (elle sera
  // rapatriée d'abord, puis partageable).
  if (!isOwnHouseCoverPhotoUrl(book.cover_url, user.id)) {
    return { ok: false, error: "Cette couverture n'est pas encore chez nous — réessaie demain." };
  }
  const sourcePath = coverStoragePathFromUrl(book.cover_url);
  if (!sourcePath) return { ok: false, error: GENERIC_ERROR_MESSAGE };

  const admin = createAdminClient();
  const targetPath = sharedCoverPath(book.barcode_raw, randomUUID());
  const { error: copyError } = await admin.storage.from(COVERS_BUCKET).copy(sourcePath, targetPath);
  if (copyError) {
    console.error("[covers] shareCover copy:", copyError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  const { data: publicUrl } = admin.storage.from(COVERS_BUCKET).getPublicUrl(targetPath);

  // Une contribution par (code, utilisateur) : re-partager remplace la copie
  // servie — l'ancienne devient orpheline, la purge (#205) la ramassera.
  const { error: upsertError } = await supabase.from("cover_contributions").upsert(
    {
      user_id: user.id,
      barcode: book.barcode_raw,
      cover_url: publicUrl.publicUrl,
      source_cover_url: book.cover_url as string,
      deleted_at: null,
    },
    { onConflict: "barcode,user_id" },
  );
  if (upsertError) {
    console.error("[covers] shareCover upsert:", upsertError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }

  revalidatePath("/bibliotheque");
  return { ok: true, shared: true };
}

/** « Ne plus partager » : retrait doux — ceux qui l'ont déjà prise la gardent. */
export async function unshareCover(bookId: string): Promise<CoverShareResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };
  const { supabase, user } = session;

  const { data: book, error } = await supabase
    .from("books")
    .select("barcode_raw")
    .eq("id", bookId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    console.error("[covers] unshareCover:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!book?.barcode_raw) return { ok: true, shared: false };

  const { error: updateError } = await supabase
    .from("cover_contributions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("barcode", book.barcode_raw)
    .is("deleted_at", null);
  if (updateError) {
    console.error("[covers] unshareCover:", updateError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  revalidatePath("/bibliotheque");
  return { ok: true, shared: false };
}
