import { normalizeSeriesName } from "@/lib/series/normalize";

/**
 * Les paires de graphies à proposer à la fusion (lot B de l'epic #289,
 * specs §4.17-9) — PUR, testé. Le SEUL rapprochement élargi autorisé : même
 * nom normalisé après retrait d'un suffixe entre parenthèses (« Berserk » /
 * « Berserk (Glénat) », le cas réel mesuré). Jamais au jugé : « Spider-Man »
 * et « Spider Man » restent deux séries, et deux séries qui portent chacune
 * un identifiant GCD ne sont jamais proposées (ce sont deux séries, la RPC
 * refuserait de toute façon).
 *
 * Une seule bannière à la fois : la première paire non ignorée.
 */

export type MergeCandidateSeries = {
  seriesId: string;
  name: string;
  /** Lus + dans la pile — le poids de la série, pour choisir laquelle garder. */
  volumeCount: number;
  hasGcdId: boolean;
};

export type MergeCandidatePair = {
  /** La série à conserver : celle qui a un identifiant GCD, sinon la plus peuplée, sinon la première par nom. */
  keep: MergeCandidateSeries;
  merge: MergeCandidateSeries;
};

/** « Berserk (Glénat) » → « berserk » — la clé élargie de la proposition. */
export const mergeKey = (name: string): string => normalizeSeriesName(name.replace(/\s*\([^)]*\)\s*$/, ""));

/** L'identité stable d'une paire, pour « Ce sont deux séries » (ignorée en localStorage). */
export const pairKey = (pair: MergeCandidatePair): string =>
  [pair.keep.seriesId, pair.merge.seriesId].sort().join("|");

const preferToKeep = (left: MergeCandidateSeries, right: MergeCandidateSeries): number =>
  Number(right.hasGcdId) - Number(left.hasGcdId) ||
  right.volumeCount - left.volumeCount ||
  left.name.localeCompare(right.name, "fr");

export function findMergeCandidates(
  seriesList: MergeCandidateSeries[],
  ignoredPairKeys: ReadonlySet<string> = new Set(),
): MergeCandidatePair[] {
  const byKey = new Map<string, MergeCandidateSeries[]>();
  for (const series of seriesList) {
    const key = mergeKey(series.name);
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), series]);
  }

  const pairs: MergeCandidatePair[] = [];
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const [keep, ...others] = [...group].sort(preferToKeep);
    for (const merge of others) {
      if (keep.hasGcdId && merge.hasGcdId) continue;
      const pair = { keep, merge };
      if (!ignoredPairKeys.has(pairKey(pair))) pairs.push(pair);
    }
  }
  return pairs;
}
