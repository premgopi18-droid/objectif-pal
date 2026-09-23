import type { ReadingStatus } from "@/lib/scoring/types";

/**
 * L'état OPTIMISTE d'une lecture du Journal (fluidité #331, item 3) : ce que
 * la ligne affiche entre le tap et la confirmation du serveur. Pur, testé —
 * `useOptimistic` ne fait qu'appliquer ce réducteur.
 *
 * On ne touche qu'au statut et aux dates que le geste implique ; tout le
 * reste (note, avis, livre) est la vérité serveur, inchangée.
 */
export type ReadingPatch = {
  readingId: string;
  status: ReadingStatus;
  /** `undefined` = ne pas toucher ; `null` = effacer (« Repasser en cours »). */
  finishedAt?: string | null;
};

type PatchableReading = { id: string; status: ReadingStatus; finishedAt: string | null };

export function applyReadingPatch<Reading extends PatchableReading>(readings: Reading[], patch: ReadingPatch): Reading[] {
  return readings.map((reading) => {
    if (reading.id !== patch.readingId) return reading;
    return {
      ...reading,
      status: patch.status,
      finishedAt: patch.finishedAt === undefined ? reading.finishedAt : patch.finishedAt,
    };
  });
}

/** Les patches des quatre gestes de statut du Journal, en un seul endroit. */
export const READING_PATCHES = {
  finish: (readingId: string, today: string): ReadingPatch => ({ readingId, status: "finished", finishedAt: today }),
  abandon: (readingId: string): ReadingPatch => ({ readingId, status: "abandoned" }),
  resume: (readingId: string): ReadingPatch => ({ readingId, status: "reading" }),
  reopen: (readingId: string): ReadingPatch => ({ readingId, status: "reading", finishedAt: null }),
};
