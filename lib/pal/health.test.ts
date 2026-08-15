import { describe, expect, it } from "vitest";
import { bookToMovement } from "./derive-pal";
import { computePalHealth, isMonthEntry, type PalMovements } from "./health";

/**
 * La santé de la PAL est la dérivation PARTAGÉE (issue #67) : elle doit rendre
 * EXACTEMENT ce que la vue PAL et le moteur stats calculaient jusqu'ici. Deux
 * angles de test :
 *  - directement, sur des MOUVEMENTS (entrées/sorties déjà réduites) — le
 *    contrat brut de la fonction ;
 *  - via le PIPELINE réel (bookToMovement → computePalHealth), pour couvrir
 *    les cas décrits en faits : pile vide, achat annulé, lecture hors PAL,
 *    abandon qui ne sort PAS de la pile (specs §4.6/§4.12).
 */

const CURRENT_MONTH = "2026-07";

/**
 * Réduit des livres (faits bruts) en mouvements via le réducteur PARTAGÉ
 * `bookToMovement` — EXACTEMENT le pipeline que derivePal et computeStats
 * exécutent (issue #78). Le helper ne fait plus que normaliser les champs
 * optionnels des fabriques et collecter les mouvements : la réduction
 * elle-même (filtres + derivePileStatus) n'est plus dupliquée ici.
 */
type BookFacts = {
  purchases?: { purchasedAt: string; deletedAt?: string | null }[];
  readings?: { status: "finished" | "reading" | "abandoned"; finishedAt?: string | null; deletedAt?: string | null }[];
  /** La possession déclarée (#101) — sans elle, on est dans le monde d'avant. */
  ownerships?: { ownedSince?: string | null; disposedAt?: string | null; deletedAt?: string | null }[];
};

function movementsFrom(books: BookFacts[]): PalMovements {
  const entryDates: string[] = [];
  const exitDates: string[] = [];
  let undatedEntryCount = 0;
  let undatedExitCount = 0;
  for (const book of books) {
    const movement = bookToMovement({
      purchases: (book.purchases ?? []).map((purchase) => ({
        purchasedAt: purchase.purchasedAt,
        deletedAt: purchase.deletedAt ?? null,
      })),
      readings: (book.readings ?? []).map((reading) => ({
        status: reading.status,
        finishedAt: reading.finishedAt ?? null,
        deletedAt: reading.deletedAt ?? null,
      })),
      ownerships: (book.ownerships ?? []).map((ownership) => ({
        ownedSince: ownership.ownedSince ?? null,
        disposedAt: ownership.disposedAt ?? null,
        deletedAt: ownership.deletedAt ?? null,
      })),
    });
    if (movement === null) continue;
    // Datés d'un côté, non datés de l'autre : c'est toute la règle #101 —
    // le stock compte tout le monde, les flux seulement ce qui a une date.
    if (movement.entryDate !== null) entryDates.push(movement.entryDate);
    else undatedEntryCount += 1;
    if (movement.exited) {
      if (movement.exitDate !== null) exitDates.push(movement.exitDate);
      else undatedExitCount += 1;
    }
  }
  return { entryDates, exitDates, undatedEntryCount, undatedExitCount };
}

describe("computePalHealth — contrat brut (sur des mouvements)", () => {
  it("pile vide : aucun mouvement → tout à zéro", () => {
    expect(computePalHealth({ entryDates: [], exitDates: [] }, CURRENT_MONTH)).toEqual({
      pileSize: 0,
      monthEntries: 0,
      monthExits: 0,
      monthBalance: 0,
    });
  });

  it("solde du mois : entrées − sorties, taille = entrés − sortis", () => {
    const health = computePalHealth(
      { entryDates: ["2026-07-03", "2026-07-05", "2026-06-01"], exitDates: ["2026-07-10"] },
      CURRENT_MONTH,
    );
    // Deux entrées en juillet (la troisième est de juin), une sortie en juillet.
    expect(health.monthEntries).toBe(2);
    expect(health.monthExits).toBe(1);
    expect(health.monthBalance).toBe(1);
    // Trois entrés, un sorti → deux encore en pile.
    expect(health.pileSize).toBe(2);
  });

  it("un solde négatif reste négatif (la pile dégonfle)", () => {
    const health = computePalHealth(
      { entryDates: ["2026-07-02"], exitDates: ["2026-07-10", "2026-07-20"] },
      CURRENT_MONTH,
    );
    expect(health.monthBalance).toBe(-1);
  });

  it("les mouvements hors du mois de référence ne comptent pas dans le solde", () => {
    const health = computePalHealth(
      { entryDates: ["2026-06-01", "2026-08-01"], exitDates: ["2026-05-01"] },
      CURRENT_MONTH,
    );
    expect(health.monthEntries).toBe(0);
    expect(health.monthExits).toBe(0);
    expect(health.monthBalance).toBe(0);
    // Mais ils comptent toujours dans la taille à date (deux entrés, un sorti).
    expect(health.pileSize).toBe(1);
  });
});

describe("computePalHealth — via le pipeline (faits → derivePileStatus → santé)", () => {
  it("un achat sans lecture : une entrée, la pile grandit de 1", () => {
    const health = computePalHealth(movementsFrom([{ purchases: [{ purchasedAt: "2026-07-03" }] }]), CURRENT_MONTH);
    expect(health).toEqual({ pileSize: 1, monthEntries: 1, monthExits: 0, monthBalance: 1 });
  });

  it("acheté puis lu : une entrée, une sortie — solde nul, pile vide", () => {
    const health = computePalHealth(
      movementsFrom([{ purchases: [{ purchasedAt: "2026-07-03" }], readings: [{ status: "finished", finishedAt: "2026-07-20" }] }]),
      CURRENT_MONTH,
    );
    expect(health).toEqual({ pileSize: 0, monthEntries: 1, monthExits: 1, monthBalance: 0 });
  });

  it("achat annulé (soft-deleted) : pas de possession, pas d'entrée", () => {
    const health = computePalHealth(
      movementsFrom([{ purchases: [{ purchasedAt: "2026-07-03", deletedAt: "2026-07-04T09:00:00Z" }] }]),
      CURRENT_MONTH,
    );
    expect(health).toEqual({ pileSize: 0, monthEntries: 0, monthExits: 0, monthBalance: 0 });
  });

  it("lecture hors PAL (emprunt, jamais acheté) : ni entrée ni sortie", () => {
    // Le piège des deux dénominateurs (§4.5) : une fin sans achat ne vide pas
    // une pile où le livre n'est jamais entré.
    const health = computePalHealth(
      movementsFrom([{ readings: [{ status: "finished", finishedAt: "2026-07-10" }] }]),
      CURRENT_MONTH,
    );
    expect(health).toEqual({ pileSize: 0, monthEntries: 0, monthExits: 0, monthBalance: 0 });
  });

  it("l'abandon ne sort PAS de la pile (specs §4.6/§4.12) : le livre y reste", () => {
    // Un achat + une lecture abandonnée : l'abandon n'est pas une fin, donc
    // aucune sortie — le livre est encore une entrée, encore dans la pile.
    const health = computePalHealth(
      movementsFrom([{ purchases: [{ purchasedAt: "2026-07-03" }], readings: [{ status: "abandoned" }] }]),
      CURRENT_MONTH,
    );
    expect(health).toEqual({ pileSize: 1, monthEntries: 1, monthExits: 0, monthBalance: 1 });
  });

  it("racheter un déjà-lu (§3.3) : aucune entrée, aucune sortie", () => {
    const health = computePalHealth(
      movementsFrom([{ purchases: [{ purchasedAt: "2026-07-05" }], readings: [{ status: "finished", finishedAt: "2026-06-12" }] }]),
      CURRENT_MONTH,
    );
    expect(health).toEqual({ pileSize: 0, monthEntries: 0, monthExits: 0, monthBalance: 0 });
  });

  it("deux exemplaires du même livre : UNE entrée, la pile ne grossit que d'un", () => {
    const health = computePalHealth(
      movementsFrom([{ purchases: [{ purchasedAt: "2026-07-02" }, { purchasedAt: "2026-07-08" }] }]),
      CURRENT_MONTH,
    );
    expect(health).toEqual({ pileSize: 1, monthEntries: 1, monthExits: 0, monthBalance: 1 });
  });

  it("une relecture ne re-vide pas la pile : une seule sortie par livre", () => {
    const health = computePalHealth(
      movementsFrom([
        {
          purchases: [{ purchasedAt: "2026-05-01" }],
          readings: [
            { status: "finished", finishedAt: "2026-05-10" },
            { status: "finished", finishedAt: "2026-07-02" },
          ],
        },
      ]),
      CURRENT_MONTH,
    );
    // La sortie a eu lieu en mai, pas en juillet : le mois de référence n'en voit rien.
    expect(health.monthExits).toBe(0);
    expect(health.pileSize).toBe(0);
  });
});

describe("les mouvements sans date — le stock sans les flux (#101)", () => {
  it("contrat brut : les non-datés comptent dans la pile, jamais dans le solde", () => {
    const health = computePalHealth(
      { entryDates: [], exitDates: [], undatedEntryCount: 12, undatedExitCount: 0 },
      CURRENT_MONTH,
    );
    expect(health).toEqual({ pileSize: 12, monthEntries: 0, monthExits: 0, monthBalance: 0 });
  });

  it("le champ est optionnel : les appelants d'avant #101 ne changent pas de résultat", () => {
    expect(computePalHealth({ entryDates: ["2026-07-03"], exitDates: [] }, CURRENT_MONTH)).toEqual({
      pileSize: 1,
      monthEntries: 1,
      monthExits: 0,
      monthBalance: 1,
    });
  });

  it("scanner son étagère : 80 livres possédés sans date → pile à 80, solde à 0", () => {
    // LE cas qui justifie tout le mécanisme. Compter ces 80 livres comme des
    // entrées du mois afficherait « +80 » au bilan de santé et raconterait une
    // explosion de la PAL qui n'a pas eu lieu.
    const shelf = Array.from({ length: 80 }, () => ({ ownerships: [{}] }));
    const health = computePalHealth(movementsFrom(shelf), CURRENT_MONTH);
    expect(health).toEqual({ pileSize: 80, monthEntries: 0, monthExits: 0, monthBalance: 0 });
  });

  it("l'étagère mélangée : les possédés non datés s'ajoutent aux achats du mois", () => {
    const health = computePalHealth(
      movementsFrom([
        { ownerships: [{}] },
        { ownerships: [{}] },
        { purchases: [{ purchasedAt: "2026-07-03" }] },
      ]),
      CURRENT_MONTH,
    );
    // 3 livres dans la pile, mais un seul mouvement du mois : l'achat.
    expect(health).toEqual({ pileSize: 3, monthEntries: 1, monthExits: 0, monthBalance: 1 });
  });

  it("« déjà lu » sans date sur un livre acheté : la pile se vide, le solde ne bouge pas", () => {
    const health = computePalHealth(
      movementsFrom([{ purchases: [{ purchasedAt: "2026-07-03" }], readings: [{ status: "finished" }] }]),
      CURRENT_MONTH,
    );
    // Entré ce mois-ci (daté), sorti à une date inconnue : la pile est vide,
    // et la sortie ne se voit dans aucun mois — on ne l'invente pas.
    expect(health).toEqual({ pileSize: 0, monthEntries: 1, monthExits: 0, monthBalance: 1 });
  });

  it("possédé sans date puis donné : la sortie datée compte, l'entrée non", () => {
    const health = computePalHealth(
      movementsFrom([{ ownerships: [{ disposedAt: "2026-07-12" }] }]),
      CURRENT_MONTH,
    );
    expect(health).toEqual({ pileSize: 0, monthEntries: 0, monthExits: 1, monthBalance: -1 });
  });
});

describe("les cessions (#142) — du stock, jamais du flux", () => {
  it("une cession fait maigrir la pile mais ne compte pas en sortie du mois", () => {
    const health = computePalHealth(
      {
        entryDates: ["2026-07-02", "2026-07-03"],
        exitDates: ["2026-07-10"], // une lecture
        disposalExitDates: ["2026-07-12"], // un don — le récit du mois l'ignore
      },
      "2026-07",
    );
    expect(health.pileSize).toBe(0); // 2 entrés − 1 lu − 1 donné : le stock dit vrai
    expect(health.monthExits).toBe(1); // seule la LECTURE compte au mois
    expect(health.monthBalance).toBe(1); // 2 entrées − 1 lue
  });
});

describe("isMonthEntry (#241) — le filtre de la tuile « Pile ce mois-ci »", () => {
  it("une entrée du mois de référence matche, les autres mois non — bornes comprises", () => {
    expect(isMonthEntry("2026-08-01", "2026-08")).toBe(true);
    expect(isMonthEntry("2026-08-31", "2026-08")).toBe(true);
    expect(isMonthEntry("2026-07-31", "2026-08")).toBe(false);
    expect(isMonthEntry("2026-09-01", "2026-08")).toBe(false);
  });

  it("une date d'entrée INCONNUE n'appartient à aucun mois (#101 — jamais de mois inventé)", () => {
    expect(isMonthEntry(null, "2026-08")).toBe(false);
  });
});
