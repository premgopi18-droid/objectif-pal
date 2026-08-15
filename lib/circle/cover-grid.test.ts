import { describe, expect, it } from "vitest";
import { FINISHED_COVERS_CAP, coverGridSlice } from "./cover-grid";

describe("coverGridSlice", () => {
  it("un mois qui tient dans le plafond s'affiche entier, sans tuile", () => {
    expect(coverGridSlice(FINISHED_COVERS_CAP, false)).toEqual({ visible: FINISHED_COVERS_CAP, hidden: 0 });
    expect(coverGridSlice(3, false)).toEqual({ visible: 3, hidden: 0 });
    expect(coverGridSlice(0, false)).toEqual({ visible: 0, hidden: 0 });
  });

  it("au-delà du plafond : le plafond + la tuile « +N » (dès +1)", () => {
    expect(coverGridSlice(FINISHED_COVERS_CAP + 1, false)).toEqual({ visible: FINISHED_COVERS_CAP, hidden: 1 });
    expect(coverGridSlice(66, false)).toEqual({ visible: FINISHED_COVERS_CAP, hidden: 56 });
  });

  it("déplié : tout s'affiche, plus de tuile", () => {
    expect(coverGridSlice(66, true)).toEqual({ visible: 66, hidden: 0 });
  });
});
