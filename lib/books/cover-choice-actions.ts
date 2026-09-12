"use server";

import { revalidatePath } from "next/cache";
import { isKnownCoverImageUrl } from "@/lib/books/cover-repair";
import { GENERIC_ERROR_MESSAGE } from "@/lib/books/errors";
import { listCoverCandidates, type CoverCandidate } from "@/lib/covers/candidates";
import { isActionAllowed, LOOKUP_RATE_LIMIT_MESSAGE } from "@/lib/resolution/lookup-rate-limit";
import { createDefaultDeps } from "@/lib/resolution/resolve";
import { getSessionOrError } from "@/lib/supabase/server";
import type { CoverActionResult } from "@/lib/books/cover-actions";

/**
 * Le sélecteur de couvertures (#276, epic #274) : lister ce que les sources
 * connaissent pour un livre, et poser celle que l'utilisateur a choisie.
 *
 * Deux règles : le choix s'écrit sur le LIVRE, jamais dans `barcode_cache`
 * (le choix de Léna ne touche pas l'exemplaire de Prem) ; et rien ne part
 * vers les sources tant que la feuille n'est pas ouverte — puis sous quota
 * (`cover_candidates`, 10/min, seuil en SQL comme les autres).
 */

export type CoverCandidatesActionResult =
  | { ok: true; candidates: CoverCandidate[]; degraded: boolean }
  | { ok: false; error: string };

export async function getCoverCandidates(bookId: string): Promise<CoverCandidatesActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };
  const { supabase, user } = session;

  const { data: book, error } = await supabase
    .from("books")
    .select("barcode_type, barcode_raw, isbn, cover_url")
    .eq("id", bookId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    console.error("[covers] getCoverCandidates:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!book) return { ok: false, error: "Livre introuvable." };

  // Le quota AVANT les sources : une salve d'ouvertures est un emballement,
  // et Google Books partage 900 appels par jour entre tout le monde.
  if (!(await isActionAllowed(supabase, "cover_candidates"))) {
    return { ok: false, error: LOOKUP_RATE_LIMIT_MESSAGE };
  }

  const { candidates, degraded } = await listCoverCandidates(
    { barcodeType: book.barcode_type as "isbn" | "upc" | null, barcode: book.barcode_raw, isbn: book.isbn },
    createDefaultDeps(),
  );
  // La couverture actuelle est déjà en tête de la feuille : pas deux fois. Une
  // rapatriée (#208) vit chez nous sous une autre URL — impossible de la
  // reconnaître ici, elle réapparaîtra parmi les candidates ; assumé.
  return { ok: true, candidates: candidates.filter((candidate) => candidate.url !== book.cover_url), degraded };
}

export async function chooseCover(bookId: string, url: string): Promise<CoverActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };
  const { supabase, user } = session;

  // Garde SSRF/qualité (review #57) : une URL hors des hôtes de couverture
  // connus n'entre pas en base — `next/image` la refuserait de toute façon.
  if (!isKnownCoverImageUrl(url)) return { ok: false, error: "Cette image ne vient pas d'une source connue." };

  const { error, count } = await supabase
    .from("books")
    .update({ cover_url: url, cover_chosen_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", bookId)
    .eq("user_id", user.id)
    .is("deleted_at", null);
  if (error) {
    console.error("[covers] chooseCover:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!count) return { ok: false, error: "Livre introuvable." };

  revalidatePath("/journal");
  revalidatePath("/bibliotheque");
  return { ok: true, coverUrl: url };
}
