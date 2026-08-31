import { describe, expect, it } from "vitest";
import { seriesAlignSheetCopy, seriesAlignedToastMessage } from "./series-align";

/**
 * Les textes de l'alignement par série (#257) — l'utilisateur décide d'un
 * geste qui change des POINTS sur la foi de ces phrases : le compte et
 * l'accord doivent être justes, au singulier comme au pluriel.
 */

describe("seriesAlignSheetCopy — la feuille de proposition", () => {
  it("au pluriel : le compte partout, série et catégorie citées", () => {
    expect(
      seriesAlignSheetCopy({ seriesName: "Berserk", category: "manga", divergentCount: 11 }, "Manga"),
    ).toEqual({
      title: "Toute la série en « Manga » ?",
      body: "11 autres tomes de « Berserk » ont une autre catégorie. Les points de leurs lectures suivront la nouvelle.",
      cta: "Appliquer aux 11 tomes",
    });
  });

  it("au singulier : l'accord suit", () => {
    const copy = seriesAlignSheetCopy({ seriesName: "Akira", category: "manga", divergentCount: 1 }, "Manga");
    expect(copy.body).toBe(
      "1 autre tome de « Akira » a une autre catégorie. Les points de ses lectures suivront la nouvelle.",
    );
    expect(copy.cta).toBe("Appliquer à l'autre tome");
  });
});

describe("seriesAlignedToastMessage — le compte RÉEL de l'UPDATE", () => {
  it("s'accorde au compte renvoyé par le serveur", () => {
    expect(seriesAlignedToastMessage(11, "Manga")).toBe("11 tomes passés en « Manga » ✓");
    expect(seriesAlignedToastMessage(1, "Manga")).toBe("1 tome passé en « Manga » ✓");
  });

  it("0 = déjà alignée ailleurs : un fait, pas un échec", () => {
    expect(seriesAlignedToastMessage(0, "Manga")).toBe("La série était déjà alignée.");
  });
});
