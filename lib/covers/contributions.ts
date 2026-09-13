import type { ScanLookupResult } from "@/lib/resolution/types";

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
