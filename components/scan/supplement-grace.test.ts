import { describe, expect, it } from "vitest";
import { hasSupplement, isReadyToEmit } from "./supplement-grace";

/**
 * La décision d'émission du scanner (fluidité #331, item 1) : un ISBN part au
 * premier décodage, un fascicule UPC attend sa fenêtre de grâce.
 */
describe("l'émission d'un code lu par la caméra (specs §5.1)", () => {
  it("un ISBN 978… nu part tout de suite : son supplément serait le prix, jeté par le routeur", () => {
    expect(isReadyToEmit("9782344036952")).toBe(true);
  });

  it("un ISBN 979… nu part tout de suite", () => {
    expect(isReadyToEmit("9791032700327")).toBe(true);
  });

  it("un ISBN lu AVEC son supplément prix part aussi (18 chiffres, le routeur le tronque)", () => {
    expect(isReadyToEmit("978067172440551095")).toBe(true);
    expect(hasSupplement("978067172440551095")).toBe(true);
  });

  it("un UPC-A nu (rendu en EAN-13 par zxing : zéro de tête) attend son supplément", () => {
    // 0 + 12 chiffres : la forme que zxing-cpp donne à un UPC-A (specs §5.3).
    expect(isReadyToEmit("0761941300894")).toBe(false);
    expect(hasSupplement("0761941300894")).toBe(false);
  });

  it("un UPC-A avec supplément part tout de suite : le supplément porte le numéro d'issue", () => {
    expect(isReadyToEmit("076194130089400111")).toBe(true);
  });

  it("un EAN-8 attend, comme avant (comportement historique inchangé)", () => {
    expect(isReadyToEmit("96385074")).toBe(false);
  });
});
