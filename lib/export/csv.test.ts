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

  it("zéro ligne = chaîne vide", () => {
    expect(toCsv([])).toBe("");
  });
});
