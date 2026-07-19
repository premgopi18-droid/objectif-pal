import type { Database } from "@/lib/supabase/database.types";
import { bookToMovement } from "@/lib/pal/derive-pal";

/**
 * Le livre est-il ACTUELLEMENT dans la pile ? — le garde du doublon d'achat
 * (specs §4.6, §3.3). Un « Je l'achète » sur un livre déjà en pile ferait un
 * −2 silencieux ; on bloque, exactement comme « déjà en cours » bloque les
 * lectures. RÈGLE : le livre est en pile s'il a un achat actif pas-encore-lu
 * (aucune fin ≤ l'achat) qui n'a pas encore été soldé par une fin de lecture.
 * Racheter un déjà-lu (§3.3) reste permis — il n'entre pas dans la pile.
 *
 * Fonction PURE, même sémantique que la vue PAL : les deux partagent le
 * réducteur bookToMovement (#78/#94), pour ne jamais diverger.
 */
type Tables = Database["public"]["Tables"];
type PurchaseRecord = Pick<Tables["purchases"]["Row"], "purchased_at" | "deleted_at">;
type ReadingRecord = Pick<Tables["readings"]["Row"], "status" | "finished_at" | "deleted_at">;

export function isBookInPile(purchases: PurchaseRecord[], readings: ReadingRecord[]): boolean {
  // Le réducteur partagé (#78/#94), via un adaptateur fin snake_case → camelCase
  // (comme derivePal) : le garde et la vue PAL passent par le MÊME filtrage
  // « achats actifs + fins terminées », écrit une seule fois dans derive-pal.
  const movement = bookToMovement({
    purchases: purchases.map((purchase) => ({
      purchasedAt: purchase.purchased_at,
      deletedAt: purchase.deleted_at,
    })),
    readings: readings.map((reading) => ({
      status: reading.status,
      finishedAt: reading.finished_at,
      deletedAt: reading.deleted_at,
    })),
  });
  // Dans la pile = entré (movement non nul) et pas encore sorti par une fin.
  return movement !== null && movement.exitDate === null;
}
