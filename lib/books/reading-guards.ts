import type { createServerSupabaseClient } from "@/lib/supabase/server";
import { GENERIC_ERROR_MESSAGE } from "./errors";

/**
 * Une lecture déjà en cours sur ce livre : on ne double pas — on le dit.
 * Le garde partagé de « je commence » (scan) et « je le commence » (PAL).
 *
 * Retourne le message d'erreur à afficher, ou null si la voie est libre.
 */
export async function getReadingInProgressError(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  bookId: string,
): Promise<string | null> {
  const { data: inProgress, error } = await supabase
    .from("readings")
    .select("id")
    .eq("user_id", userId)
    .eq("book_id", bookId)
    .eq("status", "reading")
    .is("deleted_at", null)
    .limit(1);
  if (error) {
    console.error("[books] getReadingInProgressError:", error.message);
    return GENERIC_ERROR_MESSAGE;
  }
  if (inProgress.length > 0) return "Tu as déjà ce livre en cours de lecture.";
  return null;
}
