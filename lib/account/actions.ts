"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { COVERS_BUCKET } from "@/lib/books/cover-photo";
import { GENERIC_ERROR_MESSAGE } from "@/lib/books/errors";
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

export async function deleteAccount(): Promise<DeleteAccountResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };
  const { user } = session;
  const admin = createAdminClient();

  // 1. Les photos du dossier {user_id}/ — par pages, jusqu'à épuisement.
  for (;;) {
    const { data: objects, error: listError } = await admin.storage
      .from(COVERS_BUCKET)
      .list(user.id, { limit: STORAGE_PAGE_SIZE });
    if (listError) {
      console.error("[account] deleteAccount storage list:", listError.message);
      return { ok: false, error: GENERIC_ERROR_MESSAGE };
    }
    if (!objects || objects.length === 0) break;
    const paths = objects.map((object) => `${user.id}/${object.name}`);
    const { error: removeError } = await admin.storage.from(COVERS_BUCKET).remove(paths);
    if (removeError) {
      console.error("[account] deleteAccount storage remove:", removeError.message);
      return { ok: false, error: GENERIC_ERROR_MESSAGE };
    }
    if (objects.length < STORAGE_PAGE_SIZE) break;
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
