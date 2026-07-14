"use server";

import { revalidatePath } from "next/cache";
import { getSessionOrError, type createServerSupabaseClient } from "@/lib/supabase/server";
import { isValidIsoDate } from "@/lib/dates";
import { GENERIC_ERROR_MESSAGE } from "@/lib/books/errors";
import { getReadingInProgressError } from "@/lib/books/reading-guards";
import type { BookCategory } from "@/lib/scoring/types";

/**
 * Les deux gestes du scan — specs §4.1 : le scan RÉSOUT un livre, ce qu'on en
 * fait est une ACTION choisie après. « Je commence » crée une lecture,
 * « je l'achète » crée un achat ; les deux passent par le même livre
 * (findOrCreateBook), jamais l'un par l'autre.
 *
 * Toutes les écritures passent par le client SESSION (cookies, RLS active) —
 * jamais le service role pour des données utilisateur (specs §7).
 */

/** Ce que la feuille de scan (ou la saisie manuelle) envoie — catégorie CORRIGÉE incluse. */
export type BookInput = {
  title: string;
  seriesName: string | null;
  issueNumber: string | null;
  authors: string | null;
  publisher: string | null;
  pageCount: number | null;
  coverUrl: string | null;
  /** La catégorie affichée au moment du geste — la correction de l'utilisateur fait foi. */
  category: BookCategory;
  barcodeRaw: string | null;
  barcodeType: "isbn" | "upc" | null;
  isbn: string | null;
  metadataSource: "gcd" | "bnf" | "google_books" | "metron" | "manual";
  metadataSourceId: string | null;
};

export type ScanActionResult =
  | { ok: true; bookAlreadyExisted: boolean; isRereading?: boolean }
  | { ok: false; error: string };

const BARCODE_PREFIX_LENGTH = 12;

/**
 * La date vient TOUJOURS du client (la date locale de l'appareil, modifiable) :
 * le serveur tourne en UTC, son « aujourd'hui » peut être hier ou demain à
 * Paris — exactement le bug de bilan que les specs §7 interdisent.
 */
function validateDate(date: string): string | null {
  return isValidIsoDate(date) ? date : null;
}

function validateBook(input: BookInput): string | null {
  if (!input.title?.trim()) return "Le titre est obligatoire.";
  if (input.pageCount !== null && (!Number.isInteger(input.pageCount) || input.pageCount <= 0)) {
    return "Le nombre de pages est invalide.";
  }
  return null;
}

/**
 * Un livre par code-barres et par utilisateur (specs §4.2) : le rescan
 * réutilise l'existant, et un livre supprimé en douceur est ressuscité
 * plutôt que dupliqué (la contrainte d'unicité couvre aussi les supprimés).
 *
 * Règle du rescan : l'utilisateur vient de VOIR (et éventuellement corriger)
 * la feuille — son titre et sa catégorie font foi, ils sont TOUJOURS
 * appliqués (la catégorie détermine les points au barème, et il n'existe
 * aucune autre UI pour la corriger). Les autres métadonnées ne font que
 * COMBLER les trous : une valeur non-null en base n'est jamais écrasée.
 */
async function findOrCreateBook(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  input: BookInput,
): Promise<{ bookId: string; alreadyExisted: boolean } | { error: string }> {
  if (input.barcodeRaw) {
    const { data: existing, error } = await supabase
      .from("books")
      .select("id, deleted_at, series_name, issue_number, authors, publisher, page_count, isbn, cover_url")
      .eq("user_id", userId)
      .eq("barcode_raw", input.barcodeRaw)
      .maybeSingle();
    if (error) {
      console.error("[books] findOrCreateBook:", error.message);
      return { error: GENERIC_ERROR_MESSAGE };
    }

    if (existing) {
      const { error: updateError } = await supabase
        .from("books")
        .update({
          deleted_at: null, // un livre supprimé en douceur ressuscite au rescan
          title: input.title.trim(),
          category: input.category,
          // Comblement des NULL uniquement — jamais d'écrasement d'une valeur existante.
          series_name: existing.series_name ?? input.seriesName,
          issue_number: existing.issue_number ?? input.issueNumber,
          authors: existing.authors ?? input.authors,
          publisher: existing.publisher ?? input.publisher,
          page_count: existing.page_count ?? input.pageCount,
          isbn: existing.isbn ?? input.isbn,
          cover_url: existing.cover_url ?? input.coverUrl,
          // metadata_source et metadata_source_id restent ceux de la création :
          // la paire doit désigner le même référentiel, et la source (NOT NULL)
          // n'est jamais « comblable » — on ne touche donc pas à l'id non plus.
        })
        .eq("id", existing.id);
      if (updateError) {
        console.error("[books] findOrCreateBook:", updateError.message);
        return { error: GENERIC_ERROR_MESSAGE };
      }
      return { bookId: existing.id, alreadyExisted: true };
    }
  }

  const { data: created, error: insertError } = await supabase
    .from("books")
    .insert({
      user_id: userId,
      title: input.title.trim(),
      series_name: input.seriesName,
      issue_number: input.issueNumber,
      authors: input.authors,
      publisher: input.publisher,
      page_count: input.pageCount,
      category: input.category,
      barcode_raw: input.barcodeRaw,
      barcode_type: input.barcodeType,
      barcode_prefix: input.barcodeRaw ? input.barcodeRaw.slice(0, BARCODE_PREFIX_LENGTH) : null,
      isbn: input.isbn,
      cover_url: input.coverUrl,
      metadata_source: input.metadataSource,
      metadata_source_id: input.metadataSourceId,
    })
    .select("id")
    .single();
  if (insertError) {
    console.error("[books] findOrCreateBook:", insertError.message);
    return { error: GENERIC_ERROR_MESSAGE };
  }

  return { bookId: created.id, alreadyExisted: false };
}

/** « Je commence » — crée une lecture ; 0 point pour l'instant (specs §4.1). */
export async function startReading(input: BookInput, startedAt: string): Promise<ScanActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };
  const { supabase, user } = session;

  const invalid = validateBook(input);
  if (invalid) return { ok: false, error: invalid };
  const date = validateDate(startedAt);
  if (!date) return { ok: false, error: "Date de début invalide." };

  const book = await findOrCreateBook(supabase, user.id, input);
  if ("error" in book) return { ok: false, error: book.error };

  const inProgressError = await getReadingInProgressError(supabase, user.id, book.bookId);
  if (inProgressError) return { ok: false, error: inProgressError };

  // Relire = une NOUVELLE lecture du même livre (specs §4.2) — permise, signalée.
  const { count: finishedCount, error: finishedError } = await supabase
    .from("readings")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("book_id", book.bookId)
    .eq("status", "finished")
    .is("deleted_at", null);
  if (finishedError) {
    console.error("[books] startReading:", finishedError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }

  // Le trigger en base écrit reading_events tout seul, atomiquement.
  const { error: readingError } = await supabase.from("readings").insert({
    user_id: user.id,
    book_id: book.bookId,
    status: "reading",
    started_at: date,
  });
  if (readingError) {
    console.error("[books] startReading:", readingError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }

  revalidatePath("/journal");
  return { ok: true, bookAlreadyExisted: book.alreadyExisted, isRereading: (finishedCount ?? 0) > 0 };
}

/** « Je l'achète » — crée un achat : −1 immédiat, effaçable (specs §4.1). */
export async function recordPurchase(input: BookInput, purchasedAt: string): Promise<ScanActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };
  const { supabase, user } = session;

  const invalid = validateBook(input);
  if (invalid) return { ok: false, error: invalid };
  const date = validateDate(purchasedAt);
  if (!date) return { ok: false, error: "Date d'achat invalide." };

  const book = await findOrCreateBook(supabase, user.id, input);
  if ("error" in book) return { ok: false, error: book.error };

  const { error: purchaseError } = await supabase.from("purchases").insert({
    user_id: user.id,
    book_id: book.bookId,
    purchased_at: date,
  });
  if (purchaseError) {
    console.error("[books] recordPurchase:", purchaseError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }

  revalidatePath("/journal");
  revalidatePath("/bilan");
  return { ok: true, bookAlreadyExisted: book.alreadyExisted };
}
