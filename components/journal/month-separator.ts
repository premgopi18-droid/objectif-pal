import type { JournalEntry } from "./journal-list";
import type { Month } from "@/lib/scoring/types";

/**
 * Les séparateurs du carnet de lecture (#146, #150) — la seule logique de
 * liste restée CÔTÉ CLIENT après le lot C de #32 : elle se calcule sur la
 * tranche affichée, quelle que soit sa profondeur. L'ORDRE, lui, est devenu
 * contractuel et vit dans la vue SQL `journal_entries` (l'activité d'abord,
 * le temps ensuite, le sans-date à la fin) — c'est lui qui garantit que ces
 * séparateurs tombent juste, page après page.
 */

/**
 * L'en-tête du groupe SANS DATE (#150) — les lectures d'avant l'app, saisies
 * pour mettre les données à jour : déjà reléguées en bas (#146), elles ont
 * leur en-tête comme les mois, pour ne jamais se mélanger au mois courant.
 */
export const UNDATED_SEPARATOR = "sans-date" as const;

const isUndatedFinish = (entry: JournalEntry): boolean =>
  entry.status === "finished" && entry.finishedAt === null;

/**
 * Le séparateur AU-DESSUS d'une entrée (#146, #150) : le mois de la fin quand
 * il change (section des terminées datées — le carnet de lecture), ou
 * l'en-tête « sans date » à l'entrée dans le groupe du bas.
 * `null` = pas de séparateur (autres sections, ou même groupe).
 */
export function monthSeparatorBefore(
  previous: JournalEntry | null,
  entry: JournalEntry,
): Month | typeof UNDATED_SEPARATOR | null {
  if (isUndatedFinish(entry)) {
    return previous !== null && isUndatedFinish(previous) ? null : UNDATED_SEPARATOR;
  }
  if (entry.status !== "finished" || entry.finishedAt === null) return null;
  const month = entry.finishedAt.slice(0, 7);
  const previousMonth =
    previous !== null && previous.status === "finished" && previous.finishedAt !== null
      ? previous.finishedAt.slice(0, 7)
      : null;
  return month === previousMonth ? null : month;
}
