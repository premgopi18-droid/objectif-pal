"use server";

import { revalidatePath } from "next/cache";
import { GENERIC_ERROR_MESSAGE } from "@/lib/books/errors";
import type { JournalActionResult } from "@/lib/books/journal-actions";
import { getSessionOrError } from "@/lib/supabase/server";
import { ALL_CATEGORIES, type BookCategory } from "@/lib/scoring/types";

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

/**
 * Corriger la catégorie d'un livre (#101 lot C — la correction inline de la
 * rafale ; #100 la généralisera à toute la fiche).
 *
 * C'est le seul champ qu'on corrige en un tap, et pour une raison précise :
 * **la catégorie détermine les points** (§3). Une BD classée manga, c'est 2
 * points au lieu de 1 — donc un bilan d'antenne faux. Le rescan la corrigeait
 * déjà, mais un livre saisi à la main n'a pas de code-barres à rescanner, et
 * en rafale on ne s'arrête pas pour la vérifier.
 *
 * Conséquence ASSUMÉE : corriger la catégorie change les points des lectures
 * PASSÉES de ce livre — le score est toujours dérivé, jamais stocké (§7). Le
 * bilan corrigé est le bon : c'était une erreur de saisie.
 */
export async function updateBookCategory(bookId: string, category: BookCategory): Promise<JournalActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };

  // Validation serveur : la valeur vient du client, et elle pèse sur le score.
  if (!ALL_CATEGORIES.includes(category)) return { ok: false, error: "Catégorie inconnue." };

  const { error, count } = await session.supabase
    .from("books")
    .update({ category }, { count: "exact" })
    .eq("id", bookId)
    .eq("user_id", session.user.id)
    .is("deleted_at", null);
  if (error) {
    console.error("[library] updateBookCategory:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!count) return { ok: false, error: "Livre introuvable." };

  // La catégorie pèse sur le bilan et les stats, pas seulement sur l'affichage.
  revalidatePath("/bibliotheque");
  revalidatePath("/journal");
  revalidatePath("/bilan");
  return { ok: true };
}
