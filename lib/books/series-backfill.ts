/**
 * Le rattrapage des livres BnF sans série (lot 0 de l'epic séries, #290,
 * specs §4.17 décision 12) — la partie PURE, testée : à partir d'une fiche
 * existante et de la notice BnF relue, que faut-il écrire ?
 *
 * La règle est celle du rescan (`mergeBookFieldsOnRescan`) : on ne remplit
 * que les champs VIDES, jamais on n'écrase — une fiche déjà vue par son
 * propriétaire n'est pas réécrite (titre et auteurs restent ce qu'ils sont,
 * même si la notice UNIMARC les dirait autrement).
 */

import type { BnfRecord } from "@/lib/resolution/providers/bnf";
import type { SeriesExternalRef } from "@/lib/resolution/types";

export type SeriesBackfillBookRow = {
  series_name: string | null;
  issue_number: string | null;
};

export type SeriesBackfillUpdate = {
  series_name: string;
  /** Absent quand le livre a déjà un numéro, ou que la notice n'en donne pas. */
  issue_number?: string;
};

export type SeriesBackfillPlan =
  | { outcome: "no-record" }
  | { outcome: "no-series" }
  | { outcome: "already-filled" }
  | { outcome: "fill"; update: SeriesBackfillUpdate; seriesRef: SeriesExternalRef | null };

/** Ce que la notice permet d'écrire sur ce livre — et pourquoi rien, sinon. */
export function planSeriesBackfill(book: SeriesBackfillBookRow, record: BnfRecord | null): SeriesBackfillPlan {
  if (!record) return { outcome: "no-record" };
  if (book.series_name !== null) return { outcome: "already-filled" };
  if (!record.seriesName) return { outcome: "no-series" };

  const update: SeriesBackfillUpdate = { series_name: record.seriesName };
  if (book.issue_number === null && record.issueNumber) update.issue_number = record.issueNumber;

  return {
    outcome: "fill",
    update,
    seriesRef: record.bnfSeriesId ? { source: "bnf", id: record.bnfSeriesId } : null,
  };
}
