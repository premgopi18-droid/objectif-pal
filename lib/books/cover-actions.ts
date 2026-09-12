"use server";

import { revalidatePath } from "next/cache";
import { coverPhotoPath, COVERS_BUCKET } from "@/lib/books/cover-photo";
import { GENERIC_ERROR_MESSAGE } from "@/lib/books/errors";
import { isActionAllowed } from "@/lib/resolution/lookup-rate-limit";
import { findReplacementCover } from "@/lib/resolution/resolve";
import { getSessionOrError } from "@/lib/supabase/server";

/**
 * Les gestes de couverture voulus par l'utilisateur (specs §5.4, #33 → #275).
 *
 * Décision du 12/09/2026 : **toute couverture se remplace**, à volonté. La
 * règle « filet ultime » (#47 — une couverture de source était intouchable)
 * n'existe plus ; à la place, `books.cover_chosen_at` marque le CHOIX, et les
 * automatismes (réparation #53, rescan, rapatriement #208, fusion) ne
 * remplacent jamais une couverture choisie qui s'affiche.
 */

export type CoverActionResult = { ok: true; coverUrl: string | null } | { ok: false; error: string };

/** Ce que la feuille relit d'un livre pour se rafraîchir. */
const COVER_COLUMNS = "cover_url, cover_chosen_at";

export type CoverState =
  | {
      ok: true;
      title: string;
      /** Les auteurs tels que la fiche les porte — pré-remplissent la recherche d'éditions (#277). */
      authors: string | null;
      /** Un code exploitable par les sources ? Sinon (saisie manuelle), seules les éditions et la photo restent. */
      hasCode: boolean;
      /** Le code exact du livre — la clé du pool partagé (#278) ; nul pour une saisie manuelle. */
      barcodeRaw: string | null;
      /** La couverture-source de MA contribution vivante pour ce code (#278), ou null. */
      sharedSourceCoverUrl: string | null;
      coverUrl: string | null;
      coverChosenAt: string | null;
    }
  | { ok: false; error: string };

/**
 * L'état RÉEL de la couverture d'un livre (review #280) : la feuille le relit
 * à l'ouverture, quel que soit l'écran qui l'a ouverte — le Journal ne porte
 * pas `cover_chosen_at` (vue `journal_entries`), et l'écran de fin de scan ne
 * connaît que ce que la cascade a posé, pas ce qu'un livre déjà connu avait.
 */
export async function getCoverState(bookId: string): Promise<CoverState> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };

  const { data: book, error } = await session.supabase
    .from("books")
    .select(`title, authors, barcode_type, barcode_raw, isbn, ${COVER_COLUMNS}`)
    .eq("id", bookId)
    .eq("user_id", session.user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    console.error("[covers] getCoverState:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!book) return { ok: false, error: "Livre introuvable." };
  const hasCode = (book.barcode_type === "upc" && book.barcode_raw !== null) || (book.barcode_type === "isbn" && book.isbn !== null);
  // Ma contribution vivante pour ce code (#278) — la RLS ne rend que les miennes… et celles des autres :
  // le filtre user_id est donc explicite.
  let sharedSourceCoverUrl: string | null = null;
  if (book.barcode_raw !== null) {
    const { data: contribution } = await session.supabase
      .from("cover_contributions")
      .select("source_cover_url")
      .eq("user_id", session.user.id)
      .eq("barcode", book.barcode_raw)
      .is("deleted_at", null)
      .maybeSingle();
    sharedSourceCoverUrl = contribution?.source_cover_url ?? null;
  }
  return {
    ok: true,
    title: book.title,
    authors: book.authors,
    hasCode,
    barcodeRaw: book.barcode_raw,
    sharedSourceCoverUrl,
    coverUrl: book.cover_url,
    coverChosenAt: book.cover_chosen_at,
  };
}

/**
 * L'enregistrement d'une photo. Le client a déjà uploadé le WebP dans le
 * bucket (client session, RLS par dossier) — ici on vérifie que l'objet existe
 * et on pose l'URL, versionnée, comme couverture CHOISIE.
 */
export async function recordCoverPhoto(bookId: string): Promise<CoverActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };

  const { data: book, error: readError } = await session.supabase
    .from("books")
    .select(COVER_COLUMNS)
    .eq("id", bookId)
    .eq("user_id", session.user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError) {
    console.error("[covers] recordCoverPhoto:", readError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!book) return { ok: false, error: "Livre introuvable." };

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
  // qu'on vient de lire — et le count dit franchement quand la course est perdue.
  let update = session.supabase
    .from("books")
    .update({ cover_url: versionedUrl, cover_chosen_at: new Date().toISOString() }, { count: "exact" })
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
  return { ok: true, coverUrl: versionedUrl };
}

/**
 * « Revenir à l'automatique » (#275) : le verrou saute, la chaîne couverture
 * est rejouée et son résultat posé — éventuellement rien (placeholder), la
 * photo restant possible. Métré comme la réparation (#177) : c'est le même
 * chemin externe, le plus coûteux.
 */
export async function resetCoverToAutomatic(bookId: string): Promise<CoverActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };
  const { supabase, user } = session;

  const { data: book, error: readError } = await supabase
    .from("books")
    .select(`${COVER_COLUMNS}, isbn, barcode_raw, barcode_type`)
    .eq("id", bookId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError) {
    console.error("[covers] resetCoverToAutomatic:", readError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!book) return { ok: false, error: "Livre introuvable." };
  if (book.cover_chosen_at === null) return { ok: true, coverUrl: book.cover_url };

  if (!(await isActionAllowed(supabase, "cover_repair"))) {
    return { ok: false, error: "Trop de recherches d'un coup — attends une minute et réessaie." };
  }

  const barcodeType = book.barcode_type as "isbn" | "upc" | null;
  let foundCoverUrl: string | null = null;
  try {
    foundCoverUrl = barcodeType
      ? await findReplacementCover({ barcodeType, isbn: book.isbn, barcode: book.barcode_raw })
      : null;
  } catch (error) {
    // Une chaîne en échec ne bloque pas le retour à l'automatique : le livre
    // repart sans couverture, la réparation #53 et le rescan feront le reste.
    console.error("[covers] resetCoverToAutomatic:", error instanceof Error ? error.message : String(error));
  }

  const { error: updateError } = await supabase
    .from("books")
    .update({ cover_url: foundCoverUrl, cover_chosen_at: null })
    .eq("id", bookId)
    .eq("user_id", user.id);
  if (updateError) {
    console.error("[covers] resetCoverToAutomatic:", updateError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }

  revalidatePath("/journal");
  revalidatePath("/bibliotheque");
  return { ok: true, coverUrl: foundCoverUrl };
}
