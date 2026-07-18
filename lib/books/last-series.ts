import { ALL_CATEGORIES } from "@/lib/scoring/types";
import type { BookCategory } from "@/lib/scoring/types";

/**
 * La mémoire de la dernière série saisie à la main (specs §5.3) : « la 2ᵉ
 * issue prend 3 secondes ». Donnée d'UX, pas métier → `localStorage`, pas de
 * table. Périmètre décidé (ticket #35) : LA dernière série, pas une liste —
 * ça couvre le cas réel « je saisis une run ».
 */

export type LastManualSeries = {
  seriesName: string;
  category: BookCategory;
};

const STORAGE_KEY = "objectif-pal.last-manual-series";

/** `localStorage` peut être absent (SSR) ou interdit (navigation privée). */
const browserStorage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

/** La dernière série mémorisée, ou null — toute donnée corrompue est ignorée. */
export function loadLastManualSeries(storage: Storage | null = browserStorage()): LastManualSeries | null {
  if (!storage) return null;
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
    if (typeof parsed !== "object" || parsed === null) return null;
    const { seriesName, category } = parsed as Record<string, unknown>;
    if (typeof seriesName !== "string" || seriesName.trim() === "") return null;
    if (!ALL_CATEGORIES.includes(category as BookCategory)) return null;
    return { seriesName, category: category as BookCategory };
  } catch {
    return null;
  }
}

/**
 * Mémorise la série d'une saisie validée — ou l'oublie (`null`) quand la
 * saisie n'en avait pas : pré-remplir une vieille série sur un one-shot
 * agacerait plus qu'elle n'aiderait.
 */
export function saveLastManualSeries(value: LastManualSeries | null, storage: Storage | null = browserStorage()): void {
  if (!storage) return;
  try {
    if (value === null || value.seriesName.trim() === "") {
      storage.removeItem(STORAGE_KEY);
    } else {
      storage.setItem(STORAGE_KEY, JSON.stringify(value));
    }
  } catch {
    // Stockage plein ou interdit : une mémoire de confort ne casse jamais la saisie.
  }
}
