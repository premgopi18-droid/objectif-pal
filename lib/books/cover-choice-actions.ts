"use server";

import { revalidatePath } from "next/cache";
import { isSharedCoverUrl } from "@/lib/books/cover-photo";
import { isKnownCoverImageUrl } from "@/lib/books/cover-repair";
import { GENERIC_ERROR_MESSAGE } from "@/lib/books/errors";
import { listCoverCandidates, listEditionCandidates, type CoverCandidate } from "@/lib/covers/candidates";
import { validateEditionQuery } from "@/lib/covers/edition-query";
import { contributionLabel } from "@/lib/covers/share-state";
import { isActionAllowed, LOOKUP_RATE_LIMIT_MESSAGE } from "@/lib/resolution/lookup-rate-limit";
import { createDefaultDeps } from "@/lib/resolution/resolve";
import { createAdminClient } from "@/lib/supabase/admin";
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
    .select("barcode_type, barcode_raw, isbn, cover_url, series_name, issue_number, metadata_source, metadata_source_id")
    .eq("id", bookId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    console.error("[covers] getCoverCandidates:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!book) return { ok: false, error: "Livre introuvable." };

  // Sans code exploitable (saisie manuelle), aucune source à interroger —
  // et pas de tick de quota pour rien (review #281).
  const barcodeType = book.barcode_type;
  const hasCode = (barcodeType === "upc" && book.barcode_raw !== null) || (barcodeType === "isbn" && book.isbn !== null);
  if (!hasCode) return { ok: true, candidates: [], degraded: false };

  // Le quota AVANT les sources — et avant toute lecture de plus (audit #274) :
  // une salve d'ouvertures est un emballement, et Google Books partage 900
  // appels par jour entre tout le monde.
  if (!(await isActionAllowed(supabase, "cover_candidates"))) {
    return { ok: false, error: LOOKUP_RATE_LIMIT_MESSAGE };
  }

  const deps = createDefaultDeps();
  const target = {
    barcodeType,
    barcode: book.barcode_raw,
    isbn: book.isbn,
    // L'origine de la fiche (audit #274) : un livre résolu chez Metron ou GCD
    // lit son détail en un ou deux ticks, sans repasser par les listes.
    metadataSource: book.metadata_source,
    metadataSourceId: book.metadata_source_id,
    // Comic Vine (#279) n'a pas de code-barres : série + numéro, et l'année de
    // début de la série si GCD la connaît (départage Nightwing 1996 / 2016) —
    // lue seulement si Comic Vine est branché (review #284).
    seriesName: book.series_name,
    issueNumber: book.issue_number,
    startYear:
      barcodeType === "upc" && deps.comicVine.isEnabled()
        ? await gcdSeriesStartYear(book.metadata_source, book.metadata_source_id)
        : null,
  };

  // Les contributions des autres (#278) partent en parallèle des sources : une
  // fonction `security definer` qui ne rend le pseudo qu'entre amis acceptés.
  // Défense en profondeur (audit #274) : seule une URL du dossier commun est
  // proposée, quoi que la table contienne.
  const [{ candidates, degraded }, contributions] = await Promise.all([
    listCoverCandidates(target, deps),
    target.barcode === null
      ? Promise.resolve([] as CoverCandidate[])
      : supabase
          .rpc("get_cover_contributions", { target_barcode: target.barcode })
          .then(({ data, error: rpcError }) => {
            if (rpcError) {
              console.error("[covers] get_cover_contributions:", rpcError.message);
              return [] as CoverCandidate[];
            }
            return (data ?? [])
              .filter((row) => isSharedCoverUrl(row.cover_url))
              .map((row) => ({
                url: row.cover_url,
                source: "contribution" as const,
                // Le type généré dit `string`, le SQL rend null hors amitié acceptée.
                label: contributionLabel(row.contributor_label),
                preselected: false,
              }));
          }),
  ]);
  // La couverture actuelle est déjà en tête de la feuille : pas deux fois. Une
  // rapatriée (#208) vit chez nous sous une autre URL — impossible de la
  // reconnaître ici, elle réapparaîtra parmi les candidates ; assumé.
  return { ok: true, candidates: [...candidates, ...contributions].filter((candidate) => candidate.url !== book.cover_url), degraded };
}

export async function chooseCover(bookId: string, url: string): Promise<CoverActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };
  const { supabase, user } = session;

  // Garde SSRF/qualité (review #57) : une URL hors des hôtes de couverture
  // connus n'entre pas en base — `next/image` la refuserait de toute façon.
  // Une copie du pool partagé (#278) est chez nous : acceptée aussi.
  if (!isKnownCoverImageUrl(url) && !isSharedCoverUrl(url)) return { ok: false, error: "Cette image ne vient pas d'une source connue." };

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

/**
 * Les autres éditions (#277) : recherche par titre + auteur chez OpenLibrary,
 * au tap seulement — jamais à l'ouverture, jamais au scan. Même quota que les
 * candidates : une recherche est une action. Le livre n'a même pas besoin de
 * code-barres : c'est la seule proposition possible pour une saisie manuelle.
 */
export async function searchEditionCovers(
  bookId: string,
  input: { title: string; author: string | null },
): Promise<CoverCandidatesActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };
  const { supabase, user } = session;

  const validation = validateEditionQuery(input);
  if (!validation.ok) return { ok: false, error: validation.error };

  const { data: book, error } = await supabase
    .from("books")
    .select("cover_url")
    .eq("id", bookId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    console.error("[covers] searchEditionCovers:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!book) return { ok: false, error: "Livre introuvable." };

  if (!(await isActionAllowed(supabase, "cover_candidates"))) {
    return { ok: false, error: LOOKUP_RATE_LIMIT_MESSAGE };
  }

  const { candidates, degraded } = await listEditionCandidates(validation.query, createDefaultDeps());
  return { ok: true, candidates: candidates.filter((candidate) => candidate.url !== book.cover_url), degraded };
}

/**
 * L'année de début de la série GCD d'un livre (#279) — pour départager les
 * volumes homonymes chez Comic Vine. Lecture des tables de référence (client
 * admin, comme la résolution) ; `null` si le livre ne vient pas de GCD ou si
 * la ligne a disparu du dump.
 */
async function gcdSeriesStartYear(metadataSource: string, metadataSourceId: string | null): Promise<number | null> {
  if (metadataSource !== "gcd" || metadataSourceId === null || !/^\d+$/.test(metadataSourceId)) return null;
  try {
    const admin = createAdminClient();
    // `gcd_id` n'est PAS unique (une ligne par code-barres d'une issue, §7) :
    // `maybeSingle()` jetait sur les issues à variantes — celles où l'année
    // compte (audit #274). La première ligne suffit, la série est la même.
    const { data: issues } = await admin.from("gcd_issues").select("series_id").eq("gcd_id", Number(metadataSourceId)).limit(1);
    const issue = issues?.[0];
    if (!issue?.series_id) return null;
    const { data: series } = await admin.from("gcd_series").select("year_began").eq("id", issue.series_id).maybeSingle();
    return series?.year_began ?? null;
  } catch (error) {
    console.error("[covers] gcdSeriesStartYear:", error instanceof Error ? error.message : String(error));
    return null;
  }
}
