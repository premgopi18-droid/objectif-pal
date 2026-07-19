"use server";

import { revalidatePath } from "next/cache";
import { GENERIC_ERROR_MESSAGE } from "@/lib/books/errors";
import type { JournalActionResult } from "@/lib/books/journal-actions";
import { getSessionOrError } from "@/lib/supabase/server";

/**
 * « Retirer de la bibliothèque » (issue #49) — suppression douce du LIVRE
 * SEUL, pas de cascade : ses lectures et achats restent intacts en base mais
 * disparaissent de toutes les vues, car chaque surface filtre (ou part de)
 * `books.deleted_at` — le bilan le faisait déjà, le journal l'a rejoint avec
 * cette issue. 100 % réversible : RESCANNER le livre le ressuscite avec tout
 * son historique (résurrection #10, `mergeBookFieldsOnRescan`), photo de
 * couverture comprise (l'objet Storage n'est pas touché — rien n'est jamais
 * effacé, specs §7).
 */
export async function softDeleteBook(bookId: string): Promise<JournalActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };

  const { error, count } = await session.supabase
    .from("books")
    .update({ deleted_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", bookId)
    .eq("user_id", session.user.id)
    .is("deleted_at", null);
  if (error) {
    console.error("[library] softDeleteBook:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!count) return { ok: false, error: "Livre introuvable." };

  // Le livre disparaît de PARTOUT : toutes les surfaces qui le montrent. Depuis
  // la refonte #64, la Pile est un volet de /bibliotheque et les Stats un volet
  // de /bilan — revalider ces deux routes couvre leurs deux volets.
  revalidatePath("/bibliotheque");
  revalidatePath("/journal");
  revalidatePath("/bilan");
  return { ok: true };
}
