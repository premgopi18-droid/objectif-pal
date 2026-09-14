/**
 * Le plan et le verdict du job « GCD en direct » (#308) — purs, testés,
 * partagés par scripts/series-gcd-live.mts.
 *
 *  - la SÉLECTION : les séries GCD reliées à notre référentiel, en cours (ou
 *    sans fin connue) d'abord — jamais relues, puis les plus anciennes —, les
 *    closes seulement une fois par mois ; bornées par run ;
 *  - la MISE À JOUR : ce que l'API change dans `gcd_series`, et rien d'autre
 *    (`is_current` ne passe qu'à `false`, jamais l'inverse : l'API ne l'expose
 *    pas, on ne devine pas une reprise) ;
 *  - le VERDICT : 0 réponse pour au moins une cible = rouge (Cloudflare qui
 *    refuse le runner, panne) ; une série disparue ou une erreur réseau isolée
 *    n'en est pas une.
 */

import type { GcdLiveSeries } from "@/lib/resolution/providers/gcd-live";

/** Appels série par nuit — ~145 séries reliées aujourd'hui, le parc passe en une nuit. */
export const LIVE_RUN_LIMIT = 200;
/** Appels fascicule par nuit, toutes séries confondues. */
export const LIVE_ISSUE_LIMIT = 200;
/** Fascicules nouveaux relus par série et par nuit — une série longue se rattrape en quelques nuits. */
export const LIVE_ISSUES_PER_SERIES = 10;
/** Une requête par seconde, pas plus : un service communautaire. */
export const LIVE_POLITENESS_DELAY_MS = 1000;
/** Le budget d'un run : on s'arrête proprement, le bilan sort, le reste repasse demain. */
export const LIVE_RUN_BUDGET_MS = 15 * 60 * 1000;
/** Une série close ne bouge pas : relue une fois par mois, au cas où GCD la complète. */
export const CLOSED_RECHECK_DAYS = 30;

export type LiveTarget = {
  gcdId: number;
  name: string | null;
  isCurrent: boolean | null;
  yearEnded: number | null;
  issueCount: number | null;
  lastNumber: number | null;
  liveCheckedAt: string | null;
};

const isOpen = (target: Pick<LiveTarget, "isCurrent" | "yearEnded">): boolean => target.isCurrent === true || target.yearEnded === null;

/** En cours d'abord (jamais relues, puis les plus anciennes), closes une fois par mois — bornées. */
export function selectLiveTargets(targets: readonly LiveTarget[], now: Date, limit = LIVE_RUN_LIMIT): LiveTarget[] {
  const closedCutoff = new Date(now.getTime() - CLOSED_RECHECK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return targets
    .filter((target) => isOpen(target) || target.liveCheckedAt === null || target.liveCheckedAt < closedCutoff)
    .sort(
      (left, right) =>
        Number(isOpen(right)) - Number(isOpen(left)) ||
        Number(left.liveCheckedAt !== null) - Number(right.liveCheckedAt !== null) ||
        (left.liveCheckedAt ?? "").localeCompare(right.liveCheckedAt ?? "") ||
        left.gcdId - right.gcdId,
    )
    .slice(0, limit);
}

export type SeriesPatch = { issue_count?: number; last_number?: number | null; year_ended?: number | null; is_current?: false };

/**
 * Ce que l'API change dans `gcd_series` — vide si rien ne bouge. `last_number`
 * ne descend jamais (un fascicule retiré chez GCD n'efface pas un total connu) ;
 * `is_current` ne passe qu'à `false`, quand une fin apparaît.
 */
export function seriesPatchFrom(current: Pick<LiveTarget, "isCurrent" | "yearEnded" | "issueCount" | "lastNumber">, live: GcdLiveSeries): SeriesPatch {
  const patch: SeriesPatch = {};
  if (live.issueCount !== current.issueCount) patch.issue_count = live.issueCount;
  if (live.lastNumber !== null && (current.lastNumber === null || live.lastNumber > current.lastNumber)) patch.last_number = live.lastNumber;
  if (live.yearEnded !== current.yearEnded) patch.year_ended = live.yearEnded;
  if (live.yearEnded !== null && current.isCurrent === true) patch.is_current = false;
  return patch;
}

export type LiveRunCounts = {
  targets: number;
  answered: number;
  updated: number;
  issuesAdded: number;
  gone: number;
  networkErrors: number;
  infraErrors: number;
};

/** Rouge si rien n'a répondu alors qu'il y avait à relire, ou sur erreur de notre côté. */
export function liveRunExitCode(counts: LiveRunCounts): 0 | 1 {
  if (counts.infraErrors > 0) return 1;
  if (counts.targets > 0 && counts.answered === 0) return 1;
  return 0;
}
