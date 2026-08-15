import type { Month } from "@/lib/scoring/types";

/**
 * Le classement du cercle (specs §4.14, lot B) — logique PURE, testée.
 *
 * Pas un mode compétition : chaque utilisateur a un cercle différent, le
 * classement n'est que MON tri, vu par moi — aucun bonus, aucun podium
 * officiel, zéro impact barème (le « meilleur paliste +5 » reste P2).
 *
 * Deux règles de spec :
 *  - ex-aequo = MÊME RANG (classement « compétition » : 1, 1, 3) ;
 *  - sans ligne d'agrégat = « — », HORS classement (rang null, après les
 *    classés) : le zéro est réservé à un mois JOUÉ — on ne confond pas
 *    « n'a rien fait » et « pas de bilan ».
 */

export type RankingEntry = {
  participantId: string;
  /** `null` = pas de ligne d'agrégat pour la période (affiché « — », hors rang). */
  score: number | null;
};

export type RankedEntry = RankingEntry & {
  /** 1-indexé, `null` pour les hors-rang. Ex-aequo partagent le rang. */
  rank: number | null;
};

/**
 * Classe les participants d'une période. Tri stable : à score égal, l'ordre
 * d'entrée est conservé (l'appelant fournit un ordre déterministe — par
 * pseudo) ; les hors-rang gardent leur ordre d'entrée, après les classés.
 */
export function rankParticipants(entries: RankingEntry[]): RankedEntry[] {
  const scored = entries.filter((entry): entry is RankingEntry & { score: number } => entry.score !== null);
  const unscored = entries.filter((entry) => entry.score === null);

  // `sort` est stable (spec ES2019) : l'ordre d'entrée départage les égalités.
  const sorted = [...scored].sort((left, right) => right.score - left.score);

  const ranked: RankedEntry[] = [];
  for (const [index, entry] of sorted.entries()) {
    const previous = ranked[index - 1];
    const rank = previous !== undefined && previous.score === entry.score ? (previous.rank as number) : index + 1;
    ranked.push({ ...entry, rank });
  }

  return [...ranked, ...unscored.map((entry) => ({ ...entry, rank: null }))];
}

/**
 * Le cumul de l'année civile (§4.14) : la somme des scores des mois CLOS de
 * l'année — `null` si le participant n'a AUCUN mois clos dans l'année (hors
 * rang, comme un mois sans ligne). Le mois courant n'existe pas dans les
 * agrégats : rien à exclure ici.
 */
export function yearTotal(monthScores: { month: Month; total: number }[], year: string): number | null {
  const inYear = monthScores.filter((entry) => entry.month.slice(0, 4) === year);
  if (inYear.length === 0) return null;
  return inYear.reduce((sum, entry) => sum + entry.total, 0);
}

/** L'union des mois clos du cercle, du plus récent au plus ancien — la navigation des bilans comparés. */
export function circleMonths(monthsByParticipant: Month[][]): Month[] {
  const union = new Set<Month>();
  for (const months of monthsByParticipant) {
    for (const month of months) union.add(month);
  }
  return [...union].sort().reverse();
}
