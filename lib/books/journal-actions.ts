"use server";

import { revalidatePath } from "next/cache";
import { getSessionOrError } from "@/lib/supabase/server";
import { isValidIsoDate } from "@/lib/dates";
import { GENERIC_ERROR_MESSAGE } from "@/lib/books/errors";
import { getReadingInProgressError } from "@/lib/books/reading-guards";

/**
 * Les gestes du journal — specs §4.1 et §4.2. Les transitions permises :
 *
 *   reading → finished     (LE geste qui rapporte les points, un tap)
 *   reading → abandoned    (0 point, réversible)
 *   abandoned → reading    (reprise)
 *   abandoned → finished   (points pleins, à la date de fin)
 *
 * Le trigger `append_reading_event` journalise chaque transition tout seul.
 * Rien n'est jamais effacé : « supprimer » = renseigner deleted_at.
 */

export type JournalActionResult = { ok: true } | { ok: false; error: string };

/** Note sur 5, demi-étoiles permises : un multiple de 0,5 entre 0,5 et 5. */
const isValidRating = (rating: number) => rating >= 0.5 && rating <= 5 && rating * 2 === Math.trunc(rating * 2);

/**
 * Terminer une lecture — la date vient du CLIENT (la date locale de
 * l'appareil, modifiable) : jamais l'horloge UTC du serveur (specs §7).
 */
export async function finishReading(readingId: string, finishedAt: string): Promise<JournalActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };
  if (!isValidIsoDate(finishedAt)) return { ok: false, error: "Date de fin invalide." };

  // Fin ≥ début (contrainte en base — le message est plus clair ici) : le cas
  // réel est une date de début saisie dans le futur, puis un « Terminé » du jour.
  const { data: current, error: readError } = await session.supabase
    .from("readings")
    .select("started_at")
    .eq("id", readingId)
    .eq("user_id", session.user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError) {
    console.error("[journal] finishReading:", readError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!current) return { ok: false, error: "Lecture introuvable." };
  // `started_at` est nullable depuis #101 (lecture rétroactive sans date de
  // début) : sans début connu, il n'y a pas d'ordre à faire respecter.
  if (current.started_at !== null && finishedAt < current.started_at) {
    return { ok: false, error: "La date de fin ne peut pas précéder la date de début." };
  }

  const { error, count } = await session.supabase
    .from("readings")
    .update({ status: "finished", finished_at: finishedAt }, { count: "exact" })
    .eq("id", readingId)
    .eq("user_id", session.user.id)
    .in("status", ["reading", "abandoned"])
    .is("deleted_at", null);
  if (error) {
    console.error("[journal] finishReading:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!count) return { ok: false, error: "Lecture introuvable ou déjà terminée." };

  revalidatePath("/journal");
  revalidatePath("/bilan");
  return { ok: true };
}

/**
 * « Je le commence » depuis la PAL (specs §4.6) : le livre existe déjà, un tap
 * crée la lecture — l'achat reste, la lecture s'ajoute, même book_id.
 */
export async function startReadingForBook(bookId: string, startedAt: string): Promise<JournalActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };
  if (!isValidIsoDate(startedAt)) return { ok: false, error: "Date de début invalide." };

  // Le livre doit exister et être à soi (la RLS le garantit aussi, mais le
  // message est plus clair ici qu'une violation de FK).
  const { data: book, error: bookError } = await session.supabase
    .from("books")
    .select("id")
    .eq("id", bookId)
    .eq("user_id", session.user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (bookError) {
    console.error("[journal] startReadingForBook:", bookError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!book) return { ok: false, error: "Livre introuvable." };

  const inProgressError = await getReadingInProgressError(session.supabase, session.user.id, bookId);
  if (inProgressError) return { ok: false, error: inProgressError };

  const { error } = await session.supabase.from("readings").insert({
    user_id: session.user.id,
    book_id: bookId,
    status: "reading",
    started_at: startedAt,
  });
  if (error) {
    console.error("[journal] startReadingForBook:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }

  revalidatePath("/journal");
  revalidatePath("/bibliotheque");
  return { ok: true };
}

/** Abandonner — 0 point, et toujours réversible (specs §4.2). */
export async function abandonReading(readingId: string): Promise<JournalActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };

  const { error, count } = await session.supabase
    .from("readings")
    .update({ status: "abandoned" }, { count: "exact" })
    .eq("id", readingId)
    .eq("user_id", session.user.id)
    .eq("status", "reading")
    .is("deleted_at", null);
  if (error) {
    console.error("[journal] abandonReading:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!count) return { ok: false, error: "Seule une lecture en cours peut être abandonnée." };

  revalidatePath("/journal");
  return { ok: true };
}

/** Reprendre une lecture abandonnée — la lecture repart, l'historique reste. */
export async function resumeReading(readingId: string): Promise<JournalActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };

  // Une relecture du même livre peut déjà être en cours : le garde évite la
  // violation de l'index unique (une seule lecture en cours par livre) et la
  // remplace par un message clair. La lecture qu'on reprend est `abandoned`,
  // elle ne se compte pas elle-même.
  const { data: current, error: readError } = await session.supabase
    .from("readings")
    .select("book_id")
    .eq("id", readingId)
    .eq("user_id", session.user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError) {
    console.error("[journal] resumeReading:", readError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!current) return { ok: false, error: "Lecture introuvable." };
  const inProgressError = await getReadingInProgressError(session.supabase, session.user.id, current.book_id);
  if (inProgressError) return { ok: false, error: inProgressError };

  const { error, count } = await session.supabase
    .from("readings")
    .update({ status: "reading" }, { count: "exact" })
    .eq("id", readingId)
    .eq("user_id", session.user.id)
    .eq("status", "abandoned")
    .is("deleted_at", null);
  if (error) {
    console.error("[journal] resumeReading:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!count) return { ok: false, error: "Seule une lecture abandonnée peut être reprise." };

  revalidatePath("/journal");
  return { ok: true };
}

/**
 * Repasser en cours une lecture terminée — la correction d'une mauvaise
 * manip sur « Terminé ». La date de fin s'efface (les points repartent avec
 * elle), et l'événement reste journalisé : rien n'est réécrit, on ajoute.
 */
export async function reopenReading(readingId: string): Promise<JournalActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };

  // Même garde que resumeReading : une relecture en cours du même livre peut
  // exister — la lecture qu'on rouvre est `finished`, elle ne se compte pas.
  const { data: current, error: readError } = await session.supabase
    .from("readings")
    .select("book_id")
    .eq("id", readingId)
    .eq("user_id", session.user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError) {
    console.error("[journal] reopenReading:", readError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!current) return { ok: false, error: "Lecture introuvable." };
  const inProgressError = await getReadingInProgressError(session.supabase, session.user.id, current.book_id);
  if (inProgressError) return { ok: false, error: inProgressError };

  const { error, count } = await session.supabase
    .from("readings")
    .update({ status: "reading", finished_at: null }, { count: "exact" })
    .eq("id", readingId)
    .eq("user_id", session.user.id)
    .eq("status", "finished")
    .is("deleted_at", null);
  if (error) {
    console.error("[journal] reopenReading:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!count) return { ok: false, error: "Seule une lecture terminée peut repasser en cours." };

  revalidatePath("/journal");
  revalidatePath("/bilan");
  return { ok: true };
}

/**
 * Corriger les détails après coup — dates librement saisissables (import
 * rétroactif possible, specs §4.2), note et avis modifiables à tout moment.
 */
export async function updateReadingDetails(
  readingId: string,
  details: {
    /**
     * Nullable depuis #101 : une lecture rétroactive (« je l'ai déjà lu ») n'a
     * pas de début connu. Sans ça, éditer sa note ou son avis échouerait sur
     * une date que l'utilisateur n'a jamais saisie.
     */
    startedAt: string | null;
    finishedAt: string | null;
    rating: number | null;
    comment: string | null;
  },
): Promise<JournalActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };

  if (details.startedAt !== null && !isValidIsoDate(details.startedAt)) {
    return { ok: false, error: "Date de début invalide." };
  }
  if (details.finishedAt !== null && !isValidIsoDate(details.finishedAt)) {
    return { ok: false, error: "Date de fin invalide." };
  }
  if (details.rating !== null && !isValidRating(details.rating)) {
    return { ok: false, error: "La note va de 0,5 à 5, par demi-étoile." };
  }
  // Fin ≥ début (contrainte en base — le message est plus clair ici). Sans
  // début connu (#101), il n'y a pas d'ordre à faire respecter.
  if (details.finishedAt !== null && details.startedAt !== null && details.finishedAt < details.startedAt) {
    return { ok: false, error: "La date de fin ne peut pas précéder la date de début." };
  }

  // La date de fin d'une lecture terminée ne peut pas disparaître : c'est
  // elle qui date les points (contrainte en base, message plus clair ici).
  const { data: current, error: readError } = await session.supabase
    .from("readings")
    .select("status")
    .eq("id", readingId)
    .eq("user_id", session.user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError) {
    console.error("[journal] updateReadingDetails:", readError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!current) return { ok: false, error: "Lecture introuvable." };
  if (current.status === "finished" && details.finishedAt === null) {
    return { ok: false, error: "Une lecture terminée garde une date de fin." };
  }
  // Le miroir : seule une lecture terminée porte une date de fin (c'est elle
  // qui date les points — contrainte en base, message plus clair ici).
  if (current.status !== "finished" && details.finishedAt !== null) {
    return { ok: false, error: "Seule une lecture terminée porte une date de fin." };
  }

  const { error } = await session.supabase
    .from("readings")
    .update({
      started_at: details.startedAt,
      finished_at: details.finishedAt,
      rating: details.rating,
      comment: details.comment?.trim() || null,
    })
    .eq("id", readingId)
    .eq("user_id", session.user.id);
  if (error) {
    console.error("[journal] updateReadingDetails:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }

  revalidatePath("/journal");
  revalidatePath("/bilan");
  return { ok: true };
}

/** Suppression douce — la lecture disparaît de l'app, jamais de la base (§7). */
export async function softDeleteReading(readingId: string): Promise<JournalActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };

  const { error, count } = await session.supabase
    .from("readings")
    .update({ deleted_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", readingId)
    .eq("user_id", session.user.id)
    .is("deleted_at", null);
  if (error) {
    console.error("[journal] softDeleteReading:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!count) return { ok: false, error: "Lecture introuvable." };

  revalidatePath("/journal");
  revalidatePath("/bilan");
  return { ok: true };
}
