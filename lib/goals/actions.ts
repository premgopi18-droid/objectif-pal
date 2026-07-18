"use server";

import { revalidatePath } from "next/cache";
import { GENERIC_ERROR_MESSAGE } from "@/lib/books/errors";
import { ALL_PICK_KINDS, type PickKind } from "@/lib/books/pick-kinds";
import { addMonths, isValidIsoDate } from "@/lib/dates";
import { ALL_CATEGORIES } from "@/lib/scoring/types";
import type { BookCategory } from "@/lib/scoring/types";
import { getSessionOrError } from "@/lib/supabase/server";

/**
 * Les gestes du jeu mensuel — specs §4.11 (objectif) et §4.4 (distinctions).
 * La base ne stocke que des FAITS (cibles, choix éditoriaux) : le bonus +3 et
 * les jauges restent dérivés par le moteur (§4.7), rien n'est jamais figé.
 */

export type GoalActionResult = { ok: true } | { ok: false; error: string };

/** `2026-07` est valide si `2026-07-01` est une vraie date calendaire. */
const isValidMonth = (month: string) => /^\d{4}-\d{2}$/.test(month) && isValidIsoDate(`${month}-01`);

/** En base, un mois est un `date` posé au 1er (contrainte `extract(day) = 1`). */
const toMonthDate = (month: string) => `${month}-01`;

/** Une cible par catégorie : un entier raisonnable (0 = catégorie non visée). */
const isValidTarget = (target: number) => Number.isInteger(target) && target >= 0 && target <= 99;

const isPickKind = (value: string): value is PickKind => (ALL_PICK_KINDS as readonly string[]).includes(value);

/**
 * L'objectif ne se modifie que tant que son mois est EN COURS (§4.11). Le mois
 * courant est une notion du fuseau de l'APPAREIL : l'UI ne propose l'édition
 * que sur le mois local, et ce garde serveur (horloge UTC) tolère ±1 mois pour
 * ne jamais rejeter un fuseau légitime autour de minuit — défense en
 * profondeur contre un appel forgé, pas une frontière au cheveu près.
 */
function isEditableMonth(month: string): boolean {
  const serverMonth = new Date().toISOString().slice(0, 7);
  return month >= addMonths(serverMonth, -1) && month <= addMonths(serverMonth, 1);
}

/**
 * Déclarer ou modifier l'objectif d'un mois : une cible par catégorie visée.
 * Une cible à 0 = catégorie non visée → PAS de ligne (contrainte en base) ;
 * toutes les cibles à 0 = plus d'objectif du tout (la ligne mère disparaît,
 * les cibles suivent en cascade).
 */
export async function saveMonthlyObjective(
  month: string,
  targets: Partial<Record<BookCategory, number>>,
): Promise<GoalActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };
  if (!isValidMonth(month)) return { ok: false, error: "Mois invalide." };
  if (!isEditableMonth(month)) return { ok: false, error: "L'objectif d'un mois clos ne se modifie plus." };

  const entries = Object.entries(targets) as [BookCategory, number][];
  for (const [category, target] of entries) {
    if (!ALL_CATEGORIES.includes(category) || !isValidTarget(target)) {
      return { ok: false, error: "Objectif invalide." };
    }
  }
  const activeTargets = entries.filter(([, target]) => target > 0);

  if (activeTargets.length === 0) {
    const { error } = await session.supabase
      .from("monthly_objectives")
      .delete()
      .eq("user_id", session.user.id)
      .eq("month", toMonthDate(month));
    if (error) {
      console.error("[goals] saveMonthlyObjective:", error.message);
      return { ok: false, error: GENERIC_ERROR_MESSAGE };
    }
    revalidatePath("/bilan");
    return { ok: true };
  }

  const { data: objective, error: upsertError } = await session.supabase
    .from("monthly_objectives")
    .upsert({ user_id: session.user.id, month: toMonthDate(month) }, { onConflict: "user_id,month" })
    .select("id")
    .single();
  if (upsertError || !objective) {
    console.error("[goals] saveMonthlyObjective:", upsertError?.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }

  // Remplacement complet des cibles : l'objectif du mois est un tout, pas un
  // patch — deux étapes sans transaction, mais rejouables sans dégât.
  const { error: deleteError } = await session.supabase
    .from("objective_targets")
    .delete()
    .eq("objective_id", objective.id);
  if (deleteError) {
    console.error("[goals] saveMonthlyObjective:", deleteError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  const { error: insertError } = await session.supabase.from("objective_targets").insert(
    activeTargets.map(([category, target]) => ({
      objective_id: objective.id,
      category,
      target_count: target,
    })),
  );
  if (insertError) {
    console.error("[goals] saveMonthlyObjective:", insertError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }

  revalidatePath("/bilan");
  return { ok: true };
}

/**
 * Poser (ou remplacer) une distinction du mois — un choix éditorial qui pointe
 * une lecture TERMINÉE de ce mois. Posable sur un mois passé (décision du
 * 18/07/2026, §4.4) : on prépare l'antenne après la clôture.
 */
export async function saveMonthlyPick(
  month: string,
  kind: string,
  readingId: string,
  comment: string | null,
): Promise<GoalActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };
  if (!isValidMonth(month)) return { ok: false, error: "Mois invalide." };
  if (!isPickKind(kind)) return { ok: false, error: "Distinction inconnue." };

  // La lecture doit être une fin de CE mois (la RLS garantit déjà qu'elle est
  // à soi ; ici on garantit la cohérence éditoriale, avec un message clair).
  const { data: reading, error: readError } = await session.supabase
    .from("readings")
    .select("status, finished_at")
    .eq("id", readingId)
    .eq("user_id", session.user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError) {
    console.error("[goals] saveMonthlyPick:", readError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!reading || reading.status !== "finished" || reading.finished_at?.slice(0, 7) !== month) {
    return { ok: false, error: "Une distinction pointe une lecture terminée de ce mois." };
  }

  const { error } = await session.supabase.from("monthly_picks").upsert(
    {
      user_id: session.user.id,
      month: toMonthDate(month),
      kind,
      reading_id: readingId,
      comment: comment?.trim() || null,
    },
    { onConflict: "user_id,month,kind" },
  );
  if (error) {
    console.error("[goals] saveMonthlyPick:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }

  revalidatePath("/bilan");
  return { ok: true };
}

/** Retirer une distinction — un choix éditorial se dédit sans trace (§4.4). */
export async function removeMonthlyPick(month: string, kind: string): Promise<GoalActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };
  if (!isValidMonth(month)) return { ok: false, error: "Mois invalide." };
  if (!isPickKind(kind)) return { ok: false, error: "Distinction inconnue." };

  const { error, count } = await session.supabase
    .from("monthly_picks")
    .delete({ count: "exact" })
    .eq("user_id", session.user.id)
    .eq("month", toMonthDate(month))
    .eq("kind", kind);
  if (error) {
    console.error("[goals] removeMonthlyPick:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!count) return { ok: false, error: "Distinction introuvable." };

  revalidatePath("/bilan");
  return { ok: true };
}
