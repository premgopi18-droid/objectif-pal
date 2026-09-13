"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { GENERIC_ERROR_MESSAGE } from "@/lib/books/errors";
import { coverStoragePathFromUrl, COVERS_BUCKET, isOwnHouseCoverPhotoUrl, isSharedPoolBarcode, sharedCoverPath } from "@/lib/books/cover-photo";
import { isActionAllowed, LOOKUP_RATE_LIMIT_MESSAGE } from "@/lib/resolution/lookup-rate-limit";
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

/**
 * `silent` (audit #274) : le partage AUTOMATIQUE d'une couverture rapatriée à
 * l'ouverture de la feuille ne re-rend pas la Biblio (rien à rafraîchir : la
 * feuille tient son état) — un geste de consultation ne doit pas coûter un
 * rendu complet de la liste.
 */
export async function shareCover(bookId: string, options: { silent?: boolean } = {}): Promise<CoverShareResult> {
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
  // Le code entre dans un chemin Storage écrit en SERVICE ROLE (review #283) :
  // seule la forme que produit le scan (des chiffres) est acceptée — jamais
  // un `../` venu d'une saisie forgée.
  if (!isSharedPoolBarcode(book.barcode_raw)) return { ok: false, error: "Ce code-barres ne peut pas alimenter le pool partagé." };
  // Seul le PROPRE dossier de l'appelant se copie (#180) : jamais la photo d'un
  // autre rejouée depuis un export, jamais une URL externe (elle sera
  // rapatriée d'abord, puis partageable).
  if (!isOwnHouseCoverPhotoUrl(book.cover_url, user.id)) {
    return { ok: false, error: "Cette couverture n'est pas encore chez nous — réessaie demain." };
  }
  const sourcePath = coverStoragePathFromUrl(book.cover_url);
  if (!sourcePath) return { ok: false, error: GENERIC_ERROR_MESSAGE };

  // Déjà partagée pour CETTE couverture : rien à copier (audit #274 — chaque
  // appel faisait une copie de plus, orpheline jusqu'à la purge).
  const { data: existing } = await supabase
    .from("cover_contributions")
    .select("source_cover_url")
    .eq("user_id", user.id)
    .eq("barcode", book.barcode_raw)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing?.source_cover_url === book.cover_url) return { ok: true, shared: true };

  // Métré (audit #274) : une copie Storage en service role par appel — 5/min,
  // on ne re-partage pas plus vite que ça à la main ; une boucle est un abus.
  if (!(await isActionAllowed(supabase, "cover_share"))) {
    return { ok: false, error: LOOKUP_RATE_LIMIT_MESSAGE };
  }

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
  // `deleted_at: null` ravive une contribution retirée — la colonne est dans les
  // droits UPDATE du client (grants par colonne, migration 20260913130000).
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

  if (!options.silent) revalidatePath("/bibliotheque");
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
