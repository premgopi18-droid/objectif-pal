"use server";

import { revalidatePath } from "next/cache";
import { getSessionOrError, type createServerSupabaseClient } from "@/lib/supabase/server";
import { isValidIsoDate } from "@/lib/dates";
import { GENERIC_ERROR_MESSAGE } from "@/lib/books/errors";
import { getReadingInProgressError } from "@/lib/books/reading-guards";
import { mergeBookFieldsOnRescan } from "@/lib/books/book-merge";
import { manualEntryToCacheEntry } from "@/lib/books/manual-cache";
import { isBookInPile } from "@/lib/books/pile-guard";
import { createCacheProvider } from "@/lib/resolution/providers/cache";
import type { JournalActionResult } from "@/lib/books/journal-actions";
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
  // bookId : permet de proposer la photo de couverture juste après (issue #33).
  | { ok: true; bookId: string; bookAlreadyExisted: boolean; isRereading?: boolean; purchaseId?: string }
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
      // La décision de fusion vit dans une fonction pure, testée (book-merge.ts).
      // metadata_source et metadata_source_id restent ceux de la création : la
      // paire doit désigner le même référentiel, et la source (NOT NULL) n'est
      // jamais « comblable » — on ne touche donc pas à l'id non plus.
      const { error: updateError } = await supabase
        .from("books")
        .update(mergeBookFieldsOnRescan(existing, input))
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

/**
 * Une saisie manuelle rattachée à un code-barres part dans `barcode_cache`
 * (issue #55) — APRÈS la création du livre, jamais bloquant : le geste de
 * l'utilisateur ne doit pas échouer parce que le cache partagé a toussé.
 * Une entrée d'une VRAIE source (BnF, Google Books…) n'est jamais écrasée :
 * elle peut exister si la cascade a abouti pendant que l'utilisateur sautait
 * vers la saisie manuelle — la source référencée reste meilleure que la main.
 */
async function cacheManualEntry(input: BookInput): Promise<void> {
  const entry = manualEntryToCacheEntry(input);
  if (!entry) return;
  try {
    const cache = createCacheProvider();
    const existing = await cache.get(entry.barcode);
    if (existing && existing.source !== "manual") return;
    await cache.set(entry);
  } catch (error) {
    console.error("[books] cacheManualEntry:", error instanceof Error ? error.message : String(error));
  }
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
  await cacheManualEntry(input);

  // Les deux vérifications sont indépendantes (le garde « déjà en cours » et
  // le décompte « déjà terminé » pour signaler la relecture) : en parallèle,
  // un aller-retour Supabase au lieu de deux.
  const [inProgressError, { count: finishedCount, error: finishedError }] = await Promise.all([
    getReadingInProgressError(supabase, user.id, book.bookId),
    // Relire = une NOUVELLE lecture du même livre (specs §4.2) — permise, signalée.
    supabase
      .from("readings")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("book_id", book.bookId)
      .eq("status", "finished")
      .is("deleted_at", null),
  ]);
  if (inProgressError) return { ok: false, error: inProgressError };
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
  return { ok: true, bookId: book.bookId, bookAlreadyExisted: book.alreadyExisted, isRereading: (finishedCount ?? 0) > 0 };
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
  await cacheManualEntry(input);

  // Garde du doublon (specs §4.6, §3.3) : un livre DÉJÀ dans la pile ne se
  // rachète pas — ce serait un −2 silencieux. Racheter un déjà-lu reste permis
  // (il n'entre pas dans la pile). On charge les achats + fins du livre et on
  // délègue la décision au prédicat pur, cohérent avec la vue PAL.
  const [{ data: purchases, error: purchasesError }, { data: readings, error: readingsError }] = await Promise.all([
    supabase.from("purchases").select("purchased_at, deleted_at").eq("user_id", user.id).eq("book_id", book.bookId),
    supabase
      .from("readings")
      .select("status, finished_at, deleted_at")
      .eq("user_id", user.id)
      .eq("book_id", book.bookId),
  ]);
  if (purchasesError || readingsError) {
    console.error("[books] recordPurchase:", (purchasesError ?? readingsError)?.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (isBookInPile(purchases ?? [], readings ?? [])) {
    return { ok: false, error: "Ce livre est déjà dans ta PAL." };
  }

  const { data: inserted, error: purchaseError } = await supabase
    .from("purchases")
    .insert({
      user_id: user.id,
      book_id: book.bookId,
      purchased_at: date,
    })
    .select("id")
    .single();
  if (purchaseError) {
    console.error("[books] recordPurchase:", purchaseError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }

  revalidatePath("/journal");
  revalidatePath("/bilan");
  revalidatePath("/bibliotheque"); // l'achat fait entrer le livre dans la pile (volet Pile)
  // L'id remonte pour permettre l'annulation immédiate juste après le scan.
  return { ok: true, bookId: book.bookId, bookAlreadyExisted: book.alreadyExisted, purchaseId: inserted.id };
}

/**
 * Annuler un achat — suppression douce (specs §7 : rien n'est jamais effacé de
 * la base). Deux points d'entrée : juste après le scan (« Annuler ») et depuis
 * la PAL (« Je ne l'ai pas acheté »). L'achat pèse au barème (malus −1), donc
 * on revalide aussi le bilan.
 */
export async function softDeletePurchase(purchaseId: string): Promise<JournalActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };
  const { supabase, user } = session;

  const { error, count } = await supabase
    .from("purchases")
    .update({ deleted_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", purchaseId)
    .eq("user_id", user.id)
    .is("deleted_at", null);
  if (error) {
    console.error("[books] softDeletePurchase:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!count) return { ok: false, error: "Achat introuvable." };

  revalidatePath("/bibliotheque");
  revalidatePath("/bilan");
  return { ok: true };
}
