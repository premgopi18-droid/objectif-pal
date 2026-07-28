import { describe, expect, it } from "vitest";
import { INTENT_LABELS } from "@/lib/books/scan-inbox";
import { SCORING_SCALE } from "@/lib/scoring/scale";
import { ctaLabel, submittedDate, SHEET_INTENT_ORDER, SHEET_INTENTS } from "./sheet-intents";

/**
 * La feuille d'actions du scan simple (#165) : cinq intentions égales, un
 * bouton Valider. Ces tests fixent les invariants qui ont motivé la refonte —
 * cohérence de vocabulaire avec la rafale, dates facultatives SEULEMENT pour
 * l'étagère d'avant, et plus jamais de malus recopié en dur.
 */

describe("SHEET_INTENT_ORDER — l'ordre d'affichage", () => {
  it("couvre exactement les intentions déclarées, sans doublon", () => {
    expect([...SHEET_INTENT_ORDER].sort()).toEqual(Object.keys(SHEET_INTENTS).sort());
    expect(new Set(SHEET_INTENT_ORDER).size).toBe(SHEET_INTENT_ORDER.length);
  });

  it("commence par « start » — la pré-sélection garde le quotidien à un tap", () => {
    expect(SHEET_INTENT_ORDER[0]).toBe("start");
  });
});

describe("SHEET_INTENTS — la cohérence avec la rafale", () => {
  it("réutilise les clés de la rafale (ScanIntent) + start : les deux surfaces ne peuvent plus diverger", () => {
    const burstKeys = Object.keys(INTENT_LABELS).sort();
    const sheetKeys = Object.keys(SHEET_INTENTS)
      .filter((key) => key !== "start")
      .sort();
    expect(sheetKeys).toEqual(burstKeys);
  });

  it("la date n'est facultative QUE pour l'étagère d'avant l'app (§4.13)", () => {
    expect(SHEET_INTENTS.start.dateOptional).toBe(false);
    expect(SHEET_INTENTS.purchase.dateOptional).toBe(false);
    expect(SHEET_INTENTS.own.dateOptional).toBe(true);
    expect(SHEET_INTENTS.own_read.dateOptional).toBe(true);
    expect(SHEET_INTENTS.read.dateOptional).toBe(true);
  });

  it("le malus affiché vient du barème, jamais recopié en dur", () => {
    const penalty = String(Math.abs(SCORING_SCALE.unreadPurchasePenalty));
    expect(SHEET_INTENTS.purchase.label).toContain(`−${penalty}`);
    expect(SHEET_INTENTS.purchase.cta).toContain(`−${penalty}`);
    expect(SHEET_INTENTS.purchase.note).toContain(`−${penalty}`);
  });

  it("chaque intention porte une note — l'info, et la hauteur de feuille qui ne saute pas", () => {
    for (const intent of SHEET_INTENT_ORDER) {
      expect(SHEET_INTENTS[intent].note.length).toBeGreaterThan(0);
    }
  });
});

describe("submittedDate — la date réellement soumise", () => {
  const date = "2026-07-28";

  it("date obligatoire : la case résiduelle est ignorée, la date part toujours", () => {
    expect(submittedDate("start", date, true)).toBe(date);
    expect(submittedDate("purchase", date, true)).toBe(date);
  });

  it("date facultative + « je ne sais plus » : nulle — on n'invente pas une date inconnue", () => {
    expect(submittedDate("own", date, true)).toBeNull();
    expect(submittedDate("own_read", date, true)).toBeNull();
    expect(submittedDate("read", date, true)).toBeNull();
  });

  it("date facultative renseignée : elle part telle quelle", () => {
    expect(submittedDate("own", date, false)).toBe(date);
    expect(submittedDate("read", date, false)).toBe(date);
  });

  it("champ vidé à la main sur un geste facultatif : nulle aussi — jamais de CTA bloqué sans cause (review #166)", () => {
    expect(submittedDate("own", "", false)).toBeNull();
    expect(submittedDate("own_read", "", false)).toBeNull();
    expect(submittedDate("read", "", false)).toBeNull();
  });

  it("champ vidé sur un geste à date obligatoire : la fonction rend la date telle quelle — la garde du composant bloque en amont", () => {
    expect(submittedDate("start", "", false)).toBe("");
    expect(submittedDate("purchase", "", false)).toBe("");
  });
});

describe("ctaLabel — le bouton répète l'intention", () => {
  it("« Oui, je le relis » remplace UNIQUEMENT le CTA de start quand le livre a été terminé (§4.2)", () => {
    expect(ctaLabel("start", true)).toBe("Oui, je le relis");
    expect(ctaLabel("start", false)).toBe(SHEET_INTENTS.start.cta);
  });

  it("les autres intentions sont insensibles à la relecture", () => {
    for (const intent of SHEET_INTENT_ORDER.filter((candidate) => candidate !== "start")) {
      expect(ctaLabel(intent, true)).toBe(SHEET_INTENTS[intent].cta);
      expect(ctaLabel(intent, false)).toBe(SHEET_INTENTS[intent].cta);
    }
  });
});
