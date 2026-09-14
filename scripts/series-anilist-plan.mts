/**
 * Le plan du job « fait de série depuis AniList » (#304) — pur, testé, partagé
 * par scripts/series-anilist-facts.mts.
 *
 *  - les CIBLES : les séries dont la majorité des livres reliés sont des
 *    mangas, sans fait humain (un fait GCD ou AniList est remplaçable —
 *    priorité humain > AniList > GCD) ;
 *  - l'ORDRE : celles qui ont déjà un identifiant AniList (relecture par id,
 *    statut qui peut changer) d'abord, puis les jamais rapprochées, puis les
 *    non rapprochées les plus anciennes — bornées par run ;
 *  - une série non rapprochée n'est retentée qu'après une semaine.
 */

import type { BookCategory } from "@/lib/scoring/types";

export const ANILIST_RUN_LIMIT = 120;
export const ANILIST_POLITENESS_DELAY_MS = 700;
export const ANILIST_RUN_BUDGET_MS = 20 * 60 * 1000;
/** Une série non rapprochée n'est retentée qu'après ce délai. */
export const ANILIST_RETRY_AFTER_DAYS = 7;

export type AniListTarget = {
  seriesId: string;
  name: string;
  /** L'identifiant AniList déjà posé, ou `null`. */
  aniListId: number | null;
  /** La dernière tentative de rapprochement (par titre) — `null` = jamais. */
  lastSearchedAt: string | null;
  factSource: "human" | "gcd" | "anilist";
  hasFact: boolean;
};

/** La catégorie majoritaire d'une série chez ses lecteurs (égalité : la première rencontrée). */
export function majorityCategory(categories: readonly BookCategory[]): BookCategory | null {
  const counts = new Map<BookCategory, number>();
  for (const category of categories) counts.set(category, (counts.get(category) ?? 0) + 1);
  let best: BookCategory | null = null;
  let bestCount = 0;
  for (const [category, count] of counts) {
    if (count > bestCount) {
      best = category;
      bestCount = count;
    }
  }
  return best;
}

const daysSince = (iso: string, now: Date): number => (now.getTime() - new Date(iso).getTime()) / 86_400_000;

export function selectAniListTargets(targets: readonly AniListTarget[], now: Date, limit = ANILIST_RUN_LIMIT): AniListTarget[] {
  return targets
    .filter((target) => !(target.hasFact && target.factSource === "human"))
    .filter((target) => target.aniListId !== null || target.lastSearchedAt === null || daysSince(target.lastSearchedAt, now) >= ANILIST_RETRY_AFTER_DAYS)
    .sort(
      (left, right) =>
        Number(right.aniListId !== null) - Number(left.aniListId !== null) ||
        Number(left.lastSearchedAt !== null) - Number(right.lastSearchedAt !== null) ||
        (left.lastSearchedAt ?? "").localeCompare(right.lastSearchedAt ?? "") ||
        left.name.localeCompare(right.name, "fr"),
    )
    .slice(0, limit);
}

export type AniListRunCounts = { processed: number; matched: number; unmatched: number; declared: number; networkErrors: number; infraErrors: number };

/** Rouge si notre côté a cassé, ou si TOUT le réseau a échoué ; « pas de rapprochement » n'est pas un échec. */
export function aniListRunExitCode(counts: AniListRunCounts): 0 | 1 {
  if (counts.infraErrors > 0) return 1;
  if (counts.processed > 0 && counts.networkErrors === counts.processed) return 1;
  return 0;
}
