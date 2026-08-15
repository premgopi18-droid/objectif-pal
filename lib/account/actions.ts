"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { COVERS_BUCKET } from "@/lib/books/cover-photo";
import { GENERIC_ERROR_MESSAGE } from "@/lib/books/errors";
import { AVATARS_BUCKET } from "@/lib/profile/avatar";
import { getSessionOrError } from "@/lib/supabase/server";

/**
 * La suppression de compte (RGPD, Phase 1 « Objectif 100 », epic #182) — le
 * droit à l'effacement, réel et complet :
 *
 *   1. les FICHIERS Storage du dossier {user_id}/ (photos maison — pg_dump ne
 *      les couvre pas, la cascade SQL non plus) ;
 *   2. l'entrée allowed_emails (l'email est une donnée personnelle — et un
 *      compte supprimé ne doit pas pouvoir revenir sans ré-invitation) ;
 *   3. le compte auth.users — la cascade SQL emporte profiles, books,
 *      readings, purchases, ownerships, scan_inbox, objectifs et picks
 *      (cascade VALIDÉE sur un compte jetable réel, cf. issue).
 *
 * Ce qui RESTE, volontairement : les contributions au cache partagé
 * (barcode_cache) — données bibliographiques, pas personnelles ; leur
 * created_by passe à null par la FK (on delete set null, #179).
 *
 * L'ordre est pensé pour l'échec : si le Storage ou l'allowlist échouent, le
 * compte n'est PAS supprimé (l'utilisateur peut réessayer) ; si la
 * suppression du compte échoue après le nettoyage, re-cliquer refait le
 * nettoyage (vide) puis retente — idempotent.
 */

export type DeleteAccountResult = { ok: true } | { ok: false; error: string };

const STORAGE_PAGE_SIZE = 100;

/**
 * Vide le dossier {user_id}/ d'un bucket — par pages, jusqu'à épuisement.
 * Pas d'offset (review #206) : chaque remove fait remonter la page
 * suivante — on reliste depuis le début jusqu'à une page vide ou incomplète.
 */
async function purgeStorageFolder(
  admin: ReturnType<typeof createAdminClient>,
  bucket: string,
  userId: string,
): Promise<boolean> {
  for (;;) {
    const { data: objects, error: listError } = await admin.storage
      .from(bucket)
      .list(userId, { limit: STORAGE_PAGE_SIZE });
    if (listError) {
      console.error(`[account] deleteAccount storage list (${bucket}):`, listError.message);
      return false;
    }
    if (!objects || objects.length === 0) return true;
    const paths = objects.map((object) => `${userId}/${object.name}`);
    const { error: removeError } = await admin.storage.from(bucket).remove(paths);
    if (removeError) {
      console.error(`[account] deleteAccount storage remove (${bucket}):`, removeError.message);
      return false;
    }
    if (objects.length < STORAGE_PAGE_SIZE) return true;
  }
}

export async function deleteAccount(): Promise<DeleteAccountResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };
  const { user } = session;
  const admin = createAdminClient();

  // 1. Les fichiers Storage — photos maison (covers) ET avatar (#224).
  for (const bucket of [COVERS_BUCKET, AVATARS_BUCKET]) {
    if (!(await purgeStorageFolder(admin, bucket, user.id))) {
      return { ok: false, error: GENERIC_ERROR_MESSAGE };
    }
  }

  // 2. L'invitation — l'email ne doit survivre nulle part.
  if (user.email) {
    const { error: allowlistError } = await admin.from("allowed_emails").delete().eq("email", user.email.toLowerCase());
    if (allowlistError) {
      console.error("[account] deleteAccount allowlist:", allowlistError.message);
      return { ok: false, error: GENERIC_ERROR_MESSAGE };
    }
  }

  // 3. Le compte — la cascade SQL emporte tout le reste.
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error("[account] deleteAccount:", deleteError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }

  return { ok: true };
}
