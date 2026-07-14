"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";

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

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Note sur 5, demi-étoiles permises : un multiple de 0,5 entre 0,5 et 5. */
const isValidRating = (rating: number) => rating >= 0.5 && rating <= 5 && rating * 2 === Math.trunc(rating * 2);

async function getSessionOrError() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? ({ supabase, user } as const) : null;
}

/**
 * Terminer une lecture — la date vient du CLIENT (la date locale de
 * l'appareil, modifiable) : jamais l'horloge UTC du serveur (specs §7).
 */
export async function finishReading(readingId: string, finishedAt: string): Promise<JournalActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };
  if (!ISO_DATE_PATTERN.test(finishedAt)) return { ok: false, error: "Date de fin invalide." };

  const { error, count } = await session.supabase
    .from("readings")
    .update({ status: "finished", finished_at: finishedAt }, { count: "exact" })
    .eq("id", readingId)
    .eq("user_id", session.user.id)
    .in("status", ["reading", "abandoned"])
    .is("deleted_at", null);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "Lecture introuvable ou déjà terminée." };

  revalidatePath("/journal");
  revalidatePath("/bilan");
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
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "Seule une lecture en cours peut être abandonnée." };

  revalidatePath("/journal");
  return { ok: true };
}

/** Reprendre une lecture abandonnée — la lecture repart, l'historique reste. */
export async function resumeReading(readingId: string): Promise<JournalActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };

  const { error, count } = await session.supabase
    .from("readings")
    .update({ status: "reading" }, { count: "exact" })
    .eq("id", readingId)
    .eq("user_id", session.user.id)
    .eq("status", "abandoned")
    .is("deleted_at", null);
  if (error) return { ok: false, error: error.message };
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

  const { error, count } = await session.supabase
    .from("readings")
    .update({ status: "reading", finished_at: null }, { count: "exact" })
    .eq("id", readingId)
    .eq("user_id", session.user.id)
    .eq("status", "finished")
    .is("deleted_at", null);
  if (error) return { ok: false, error: error.message };
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
    startedAt: string;
    finishedAt: string | null;
    rating: number | null;
    comment: string | null;
  },
): Promise<JournalActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };

  if (!ISO_DATE_PATTERN.test(details.startedAt)) return { ok: false, error: "Date de début invalide." };
  if (details.finishedAt !== null && !ISO_DATE_PATTERN.test(details.finishedAt)) {
    return { ok: false, error: "Date de fin invalide." };
  }
  if (details.rating !== null && !isValidRating(details.rating)) {
    return { ok: false, error: "La note va de 0,5 à 5, par demi-étoile." };
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
  if (readError) return { ok: false, error: readError.message };
  if (!current) return { ok: false, error: "Lecture introuvable." };
  if (current.status === "finished" && details.finishedAt === null) {
    return { ok: false, error: "Une lecture terminée garde une date de fin." };
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
  if (error) return { ok: false, error: error.message };

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
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "Lecture introuvable." };

  revalidatePath("/journal");
  revalidatePath("/bilan");
  return { ok: true };
}
