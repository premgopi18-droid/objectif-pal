import { describe, expect, it } from "vitest";
import { classifyScannedCode, isbn13ToIsbn10, normalizeUpcForMetron } from "./barcode-router";

describe("le routage du code scanné (specs §5.1)", () => {
  it("un EAN-13 978… est un ISBN", () => {
    const code = classifyScannedCode("9782344036952");
    expect(code).toMatchObject({ type: "isbn", ean13: "9782344036952" });
  });

  it("un EAN-13 979… est un ISBN (sans équivalent ISBN-10)", () => {
    const code = classifyScannedCode("9791032700327");
    expect(code).toMatchObject({ type: "isbn", isbnCandidates: ["9791032700327"] });
  });

  it("le supplément d'un ISBN est le PRIX : on le jette", () => {
    // Le cas réel des specs §5.1 : 978067172440551095 → 51095 = 10,95 $.
    const code = classifyScannedCode("978067172440551095");
    expect(code).toMatchObject({ type: "isbn", ean13: "9780671724405" });
  });

  it("un ISBN-13 978… produit aussi son équivalent ISBN-10 (GCD stocke les deux)", () => {
    const code = classifyScannedCode("9780671724405");
    expect(code.type).toBe("isbn");
    if (code.type === "isbn") expect(code.isbnCandidates).toEqual(["9780671724405", "0671724401"]);
  });

  it("un UPC-A 12 chiffres est un fascicule, sans supplément", () => {
    expect(classifyScannedCode("761941341743")).toEqual({
      type: "upc",
      raw: "761941341743",
      base: "761941341743",
      supplement: null,
    });
  });

  it("le supplément d'un UPC est le numéro d'issue : on le GARDE", () => {
    expect(classifyScannedCode("76194134174312321")).toEqual({
      type: "upc",
      raw: "76194134174312321",
      base: "761941341743",
      supplement: "12321",
    });
  });

  it("les séparateurs et espaces du scan sont nettoyés", () => {
    expect(classifyScannedCode("978-2-344-03695-2")).toMatchObject({ type: "isbn", ean13: "9782344036952" });
  });

  it("un code trop court est invalide (jamais d'exception)", () => {
    expect(classifyScannedCode("1234")).toEqual({ type: "invalid", raw: "1234" });
  });
});

describe("isbn13ToIsbn10", () => {
  it("convertit un 978 en recalculant la clé", () => {
    // Vérifié contre la ligne réelle du dump GCD : 9780671724405 ↔ 0671724401.
    expect(isbn13ToIsbn10("9780671724405")).toBe("0671724401");
  });

  it("sait produire la clé X", () => {
    // Couple réel : 978-0-439-42089-1 ↔ 0-439-42089-X.
    expect(isbn13ToIsbn10("9780439420891")).toBe("043942089X");
  });

  it("refuse un 979", () => {
    expect(isbn13ToIsbn10("9791032700327")).toBeNull();
  });
});

describe("normalizeUpcForMetron (la variante → couverture principale)", () => {
  it("remet le chiffre de couverture à 1", () => {
    // Cas réels mesurés (specs §5.4) : GCD indexe la variante, Metron la principale.
    expect(normalizeUpcForMetron("76194134174312321")).toBe("76194134174312311");
    expect(normalizeUpcForMetron("75960620928601421")).toBe("75960620928601411");
  });

  it("laisse une couverture principale inchangée", () => {
    expect(normalizeUpcForMetron("76194134174312311")).toBe("76194134174312311");
  });

  it("rend null sans supplément (rien à normaliser)", () => {
    expect(normalizeUpcForMetron("761941341743")).toBeNull();
  });
});
