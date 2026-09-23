import { describe, expect, it } from "vitest";
import { decideEmission, hasSupplement, isReadyToEmit } from "./supplement-grace";

/**
 * La décision d'émission du scanner (fluidité #331, item 1) : un ISBN part au
 * premier décodage, un fascicule UPC attend sa fenêtre de grâce — et la règle
 * de rafale #249 (un code différent émet d'abord celui en grâce) passe AVANT
 * tout raccourci (review #334).
 */
const ISBN = "9782344036952";
const ISBN_WITH_PRICE = "978067172440551095";
// 0 + 12 chiffres : la forme que zxing-cpp donne à un UPC-A (specs §5.3).
const UPC_BARE = "0761941300894";
const UPC_WITH_SUPPLEMENT = "076194130089400111";

describe("isReadyToEmit — un code complet part sans grâce (specs §5.1)", () => {
  it("un ISBN 978… nu part tout de suite : son supplément serait le prix, jeté par le routeur", () => {
    expect(isReadyToEmit(ISBN)).toBe(true);
  });

  it("un ISBN 979… nu part tout de suite", () => {
    expect(isReadyToEmit("9791032700327")).toBe(true);
  });

  it("un ISBN lu AVEC son supplément prix part aussi (18 chiffres, le routeur le tronque)", () => {
    expect(isReadyToEmit(ISBN_WITH_PRICE)).toBe(true);
    expect(hasSupplement(ISBN_WITH_PRICE)).toBe(true);
  });

  it("un UPC-A nu (zéro de tête) attend son supplément : il porte le numéro d'issue", () => {
    expect(isReadyToEmit(UPC_BARE)).toBe(false);
    expect(hasSupplement(UPC_BARE)).toBe(false);
  });

  it("un UPC-A avec supplément part tout de suite", () => {
    expect(isReadyToEmit(UPC_WITH_SUPPLEMENT)).toBe(true);
  });

  it("un EAN-8 attend, comme avant — même en 978… : le routeur exige 13 chiffres pour un ISBN", () => {
    expect(isReadyToEmit("96385074")).toBe(false);
    expect(isReadyToEmit("97812345")).toBe(false);
  });
});

describe("decideEmission — le code lu face au code en grâce", () => {
  it("rien en grâce : un code prêt part, un UPC nu ouvre la grâce", () => {
    expect(decideEmission(ISBN, null, false)).toEqual({ kind: "emit", code: ISBN });
    expect(decideEmission(UPC_BARE, null, true)).toEqual({ kind: "wait", code: UPC_BARE });
  });

  it("le supplément arrive pendant la grâce du même UPC : le code complet part", () => {
    expect(decideEmission(UPC_WITH_SUPPLEMENT, UPC_BARE, true)).toEqual({ kind: "emit", code: UPC_WITH_SUPPLEMENT });
    expect(decideEmission(UPC_WITH_SUPPLEMENT, UPC_BARE, false)).toEqual({ kind: "emit", code: UPC_WITH_SUPPLEMENT });
  });

  it("RAFALE, étagère mixte (review #334) : un ISBN lu pendant la grâce d'un fascicule émet d'abord le fascicule", () => {
    // Sans cette règle, le raccourci ISBN effaçait la grâce et le fascicule
    // n'était jamais émis — exactement le trou que #249 avait bouché.
    expect(decideEmission(ISBN, UPC_BARE, true)).toEqual({ kind: "emit", code: UPC_BARE });
  });

  it("RAFALE (#249) : un UPC nu différent de celui en grâce émet d'abord celui en grâce", () => {
    expect(decideEmission("0761941300900", UPC_BARE, true)).toEqual({ kind: "emit", code: UPC_BARE });
  });

  it("RAFALE : le même UPC nu relu pendant sa grâce ne fait que suivre", () => {
    expect(decideEmission(UPC_BARE, UPC_BARE, true)).toEqual({ kind: "track", code: UPC_BARE });
  });

  it("scan UNITAIRE : le dernier code vu gagne — un ISBN part même si un UPC était en grâce", () => {
    expect(decideEmission(ISBN, UPC_BARE, false)).toEqual({ kind: "emit", code: ISBN });
  });

  it("scan UNITAIRE : un autre UPC nu pendant la grâce remplace le code suivi", () => {
    expect(decideEmission("0761941300900", UPC_BARE, false)).toEqual({ kind: "track", code: "0761941300900" });
  });
});
