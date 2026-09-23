import { isBookInPile } from "@/lib/books/pile-guard";

/**
 * Le plan de « Possédé, déjà lu » (fluidité #332, item 5) — les deux faits
 * d'un seul geste, décidés d'un coup à partir des faits du livre chargés en
 * un étage. Pur, testé ; `recordOwnedPastReading` ne fait que l'exécuter.
 *
 * Règles héritées des deux actions qu'il remplace (§4.13) :
 *  - « déjà possédé » n'est PAS un échec ici : on redéclare simplement une
 *    lecture sur un livre déjà à soi (`ownership: "keep"`) ;
 *  - une déclaration close (don, revente) se RESSUSCITE plutôt que d'en
 *    insérer une seconde — la base n'en tolère qu'une active par livre ;
 *  - sinon, une possession neuve, SANS date : la date connue est celle de la
 *    lecture, pas de l'acquisition (audit post-#101).
 */
// Les mêmes formes que le garde de pile (types dérivés, jamais recopiés).
type PileGuardArguments = Parameters<typeof isBookInPile>;
type Purchase = PileGuardArguments[0][number];
type Reading = PileGuardArguments[1][number];
type Ownership = NonNullable<PileGuardArguments[2]>[number] & { id: string }; // le 3ᵉ paramètre du garde est optionnel

export type OwnershipPlan = { kind: "keep" } | { kind: "revive"; ownershipId: string } | { kind: "insert" };

export function planOwnedPastReading(facts: { purchases: Purchase[]; readings: Reading[]; ownerships: Ownership[] }): OwnershipPlan {
  if (isBookInPile(facts.purchases, facts.readings, facts.ownerships)) return { kind: "keep" };
  const existing = facts.ownerships.find((ownership) => ownership.deleted_at === null);
  if (!existing) return { kind: "insert" };
  // Une déclaration ACTIVE et ouverte (livre déjà lu, donc hors pile, mais
  // toujours à soi) : rien à toucher — surtout pas sa date d'acquisition, que
  // l'ancien enchaînement effaçait au passage.
  return existing.disposed_at === null ? { kind: "keep" } : { kind: "revive", ownershipId: existing.id };
}
