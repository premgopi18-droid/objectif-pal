import { isSharedCoverUrl } from "@/lib/books/cover-photo";
import { classifyScannedCode } from "@/lib/resolution/barcode-router";
import type { ScanLookupResult } from "@/lib/resolution/types";
import type { createServerSupabaseClient } from "@/lib/supabase/server";

type SessionSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

/**
 * La contribution du pool pour un code scanné, ou null (#278). Partagée par la
 * route de lookup et la seconde phase du scan différé (fluidité #332, item 3).
 * Défense en profondeur (audit #274) : seule une URL du dossier commun peut
 * devenir la couverture par défaut de quelqu'un, quoi que la table contienne.
 */
export async function findContributionCover(supabase: SessionSupabaseClient, raw: string): Promise<string | null> {
  const code = classifyScannedCode(raw);
  if (code.type === "invalid") return null;
  const { data, error } = await supabase.rpc("get_cover_contributions", { target_barcode: code.raw });
  if (error) {
    console.error("[lookup] get_cover_contributions:", error.message);
    return null;
  }
  return (data ?? []).find((row) => isSharedCoverUrl(row.cover_url))?.cover_url ?? null;
}

/**
 * Le pool partagé au SCAN (#278) : une contribution ne devient couverture par
 * défaut que pour un code qu'aucune source ne couvre — et seulement sur le
 * résultat rendu au client, jamais dans `barcode_cache` ni `barcode_misses`
 * (la route l'applique APRÈS la cascade, qui seule écrit le cache).
 */
export function withContributionCover(result: ScanLookupResult, contributionCoverUrl: string | null): ScanLookupResult {
  if (contributionCoverUrl === null) return result;
  if (result.kind === "resolved" && result.book.coverUrl === null) {
    return { ...result, book: { ...result.book, coverUrl: contributionCoverUrl } };
  }
  if (result.kind === "not-found" && result.coverUrl === null) {
    return { ...result, coverUrl: contributionCoverUrl };
  }
  return result;
}
