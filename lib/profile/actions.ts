"use server";

import { revalidatePath } from "next/cache";
import { GENERIC_ERROR_MESSAGE } from "@/lib/books/errors";
import { AVATARS_BUCKET, avatarPath } from "@/lib/profile/avatar";
import { normalizeDisplayName } from "@/lib/profile/display-name";
import { getSessionOrError } from "@/lib/supabase/server";

/**
 * Les gestes du profil (issue #224) — pseudo et photo. Tout passe par le
 * client SESSION : la RLS `profiles_update_own` et le cloisonnement par
 * dossier du bucket `avatars` font autorité, jamais le client admin.
 */

export type ProfileActionResult = { ok: true } | { ok: false; error: string };

export async function updateDisplayName(raw: string): Promise<ProfileActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };

  const normalized = normalizeDisplayName(raw);
  if (!normalized.ok) return normalized;

  const { error } = await session.supabase
    .from("profiles")
    .update({ display_name: normalized.value })
    .eq("id", session.user.id);
  if (error) {
    console.error("[profile] updateDisplayName:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }

  revalidatePath("/profil");
  return { ok: true };
}

/**
 * Le client a déjà uploadé le WebP dans `avatars/{user_id}/avatar.webp`
 * (client session, RLS par dossier) — ici on VÉRIFIE que l'objet existe puis
 * on pose l'URL : on ne référence jamais un objet qui 404erait. L'objet est
 * écrasé au même chemin, le `?v=` versionne l'URL pour percer les caches
 * (même patron que recordCoverPhoto, #33/#47).
 */
export async function recordAvatarPhoto(): Promise<ProfileActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };

  const { data: objects, error: listError } = await session.supabase.storage
    .from(AVATARS_BUCKET)
    .list(session.user.id, { search: "avatar.webp", limit: 1 });
  if (listError) {
    console.error("[profile] recordAvatarPhoto:", listError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!objects || objects.length === 0) {
    return { ok: false, error: "La photo n'a pas été reçue — réessaie." };
  }

  const path = avatarPath(session.user.id);
  const { data: publicUrl } = session.supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path);
  const versionedUrl = `${publicUrl.publicUrl}?v=${Date.now()}`;
  const { error: updateError } = await session.supabase
    .from("profiles")
    .update({ avatar_url: versionedUrl })
    .eq("id", session.user.id);
  if (updateError) {
    console.error("[profile] recordAvatarPhoto:", updateError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }

  revalidatePath("/profil");
  return { ok: true };
}

/** Retirer la photo : l'objet part du bucket, l'URL part du profil — retour à l'initiale. */
export async function removeAvatarPhoto(): Promise<ProfileActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };

  // L'ordre est pensé pour l'échec : URL d'abord (plus rien ne la référence),
  // objet ensuite — si le remove échoue, l'objet orphelin sera écrasé par la
  // prochaine photo ou emporté par la suppression de compte, jamais affiché.
  const { error: updateError } = await session.supabase
    .from("profiles")
    .update({ avatar_url: null })
    .eq("id", session.user.id);
  if (updateError) {
    console.error("[profile] removeAvatarPhoto:", updateError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }

  const { error: removeError } = await session.supabase.storage
    .from(AVATARS_BUCKET)
    .remove([avatarPath(session.user.id)]);
  if (removeError) {
    // L'URL est déjà retirée : on le NOTE (l'objet sera écrasé/purgé), sans
    // faire échouer un geste dont l'effet visible est acquis.
    console.error("[profile] removeAvatarPhoto storage:", removeError.message);
  }

  revalidatePath("/profil");
  return { ok: true };
}
