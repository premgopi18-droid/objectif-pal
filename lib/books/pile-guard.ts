import type { Database } from "@/lib/supabase/database.types";
import { bookToMovement } from "@/lib/pal/derive-pal";

/**
 * Le livre est-il ACTUELLEMENT dans la pile ? — le garde du doublon d'achat
 * (specs §4.6, §3.3). Un « Je l'achète » sur un livre déjà en pile ferait un
 * −2 silencieux ; on bloque, exactement comme « déjà en cours » bloque les
 * lectures. RÈGLE : le livre est en pile s'il est possédé (achat actif OU
 * possession déclarée, #101) sans avoir été soldé par une fin de lecture ni
 * par une sortie de possession. Acquérir un déjà-lu (§3.3) reste permis — il
 * n'entre pas dans la pile.
 *
 * Fonction PURE, même sémantique que la vue PAL : les deux partagent le
 * réducteur bookToMovement (#78/#94), pour ne jamais diverger.
 */
type Tables = Database["public"]["Tables"];
type PurchaseRecord = Pick<Tables["purchases"]["Row"], "purchased_at" | "deleted_at">;
type ReadingRecord = Pick<Tables["readings"]["Row"], "status" | "finished_at" | "deleted_at">;
type OwnershipRecord = Pick<Tables["ownerships"]["Row"], "owned_since" | "disposed_at" | "deleted_at">;

export function isBookInPile(
  purchases: PurchaseRecord[],
  readings: ReadingRecord[],
  ownerships: OwnershipRecord[] = [],
): boolean {
  // Le réducteur partagé (#78/#94), via un adaptateur fin snake_case → camelCase
  // (comme derivePal) : le garde et la vue PAL passent par le MÊME filtrage
  // « achats actifs + possession + fins terminées », écrit une seule fois dans
  // derive-pal.
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
    ownerships: ownerships.map((ownership) => ({
      ownedSince: ownership.owned_since,
      disposedAt: ownership.disposed_at,
      deletedAt: ownership.deleted_at,
    })),
  });
  // Dans la pile = entré (movement non nul) et pas encore sorti — quelle que
  // soit la raison de la sortie, datée ou non (`exited`, pas `exitDate` : un
  // « déjà lu » sans date sort bien le livre de la pile, #101).
  return movement !== null && !movement.exited;
}
