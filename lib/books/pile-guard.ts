import type { Database } from "@/lib/supabase/database.types";
import type { IsoDate } from "@/lib/scoring/types";
import { derivePileStatus } from "@/lib/pal/derive-pal";

/**
 * Le livre est-il ACTUELLEMENT dans la pile ? — le garde du doublon d'achat
 * (specs §4.6, §3.3). Un « Je l'achète » sur un livre déjà en pile ferait un
 * −2 silencieux ; on bloque, exactement comme « déjà en cours » bloque les
 * lectures. RÈGLE : le livre est en pile s'il a un achat actif pas-encore-lu
 * (aucune fin ≤ l'achat) qui n'a pas encore été soldé par une fin de lecture.
 * Racheter un déjà-lu (§3.3) reste permis — il n'entre pas dans la pile.
 *
 * Fonction PURE, même sémantique que la vue PAL : les deux partagent le cœur
 * derivePileStatus, pour ne jamais diverger.
 */
type Tables = Database["public"]["Tables"];
type PurchaseRecord = Pick<Tables["purchases"]["Row"], "purchased_at" | "deleted_at">;
type ReadingRecord = Pick<Tables["readings"]["Row"], "status" | "finished_at" | "deleted_at">;

export function isBookInPile(purchases: PurchaseRecord[], readings: ReadingRecord[]): boolean {
  const activePurchaseDates = purchases
    .filter((purchase) => purchase.deleted_at === null)
    .map((purchase) => purchase.purchased_at as IsoDate);
  const finishedDates = readings
    .filter((reading) => reading.deleted_at === null && reading.status === "finished" && reading.finished_at !== null)
    .map((reading) => reading.finished_at as IsoDate);

  const { entryDate, exitDate } = derivePileStatus(activePurchaseDates, finishedDates);
  return entryDate !== null && exitDate === null;
}
