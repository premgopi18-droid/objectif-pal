import type { Database } from "@/lib/supabase/database.types";

/**
 * Les distinctions du mois (specs §4.4) — trois choix ÉDITORIAUX, jamais des
 * calculs : une base ne sait pas ce qu'est une surprise. Miroir de l'enum
 * `pick_kind` en base, avec l'ordre d'affichage et les libellés UI.
 */

export type PickKind = Database["public"]["Enums"]["pick_kind"];

/** Les trois distinctions dans l'ordre d'affichage — LA source unique. */
export const ALL_PICK_KINDS: readonly PickKind[] = ["favorite", "good_surprise", "bad_surprise"];

export const PICK_KIND_LABELS: Record<PickKind, string> = {
  favorite: "L'œuvre préférée du mois",
  good_surprise: "La bonne surprise",
  bad_surprise: "La mauvaise surprise",
};
