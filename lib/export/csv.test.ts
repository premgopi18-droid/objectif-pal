import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("le CSV de l'export (specs §4.10)", () => {
  it("écrit l'en-tête depuis les clés, et les lignes dans l'ordre", () => {
    const csv = toCsv([
      { title: "Tintin", pages: 62 },
      { title: "Nightwing", pages: 32 },
    ]);
    expect(csv).toBe("title,pages\r\nTintin,62\r\nNightwing,32\r\n");
  });

  it("échappe virgules, guillemets et retours à la ligne (les avis en sont pleins)", () => {
    const csv = toCsv([{ comment: 'lâché deux fois, puis "accroché"\navant la fin' }]);
    expect(csv).toBe('comment\r\n"lâché deux fois, puis ""accroché""\navant la fin"\r\n');
  });

  it("null et undefined deviennent des champs vides", () => {
    expect(toCsv([{ rating: null, comment: undefined, title: "X" }])).toBe("rating,comment,title\r\n,,X\r\n");
  });

  it("zéro ligne SANS en-têtes = chaîne vide", () => {
    expect(toCsv([])).toBe("");
  });

  it("zéro ligne AVEC en-têtes = la ligne d'en-tête seule (un export vide reste lisible)", () => {
    expect(toCsv([], ["id", "title"])).toBe("id,title\r\n");
  });

  it("les en-têtes explicites imposent l'ordre et le sous-ensemble des colonnes", () => {
    expect(toCsv([{ title: "X", id: 1, extra: "jamais" }], ["id", "title"])).toBe("id,title\r\n1,X\r\n");
  });

  it("neutralise l'injection de formule : une chaîne commençant par = est préfixée d'une apostrophe", () => {
    const csv = toCsv([{ comment: '=HYPERLINK("http://evil")' }]);
    expect(csv).toBe("comment\r\n\"'=HYPERLINK(\"\"http://evil\"\")\"\r\n");
  });

  it("un nombre négatif reste un nombre — jamais préfixé", () => {
    expect(toCsv([{ penalty: -1 }])).toBe("penalty\r\n-1\r\n");
  });

  it("une chaîne normale sort intacte", () => {
    expect(toCsv([{ title: "Tintin au Tibet" }])).toBe("title\r\nTintin au Tibet\r\n");
  });
});
