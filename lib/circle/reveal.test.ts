import { describe, expect, it } from "vitest";
import { autoRevealMonth, isAutoRevealed, isRevealedToCircle } from "./reveal";

describe("isAutoRevealed — le miroir du prédicat SQL (#243)", () => {
  it("le dernier mois clos reste verrouillé, l'avant-dernier est auto-révélé", () => {
    // En août : juillet (clos le 1er août) attend son émission, juin est public.
    expect(isAutoRevealed("2026-07", "2026-08")).toBe(false);
    expect(isAutoRevealed("2026-06", "2026-08")).toBe(true);
  });

  it("le changement d'année ne casse pas la règle", () => {
    // En janvier : décembre verrouillé, novembre public.
    expect(isAutoRevealed("2025-12", "2026-01")).toBe(false);
    expect(isAutoRevealed("2025-11", "2026-01")).toBe(true);
    // En février : décembre a eu son mois entier.
    expect(isAutoRevealed("2025-12", "2026-02")).toBe(true);
  });

  it("le mois courant n'est jamais auto-révélé (il n'a même pas de ligne)", () => {
    expect(isAutoRevealed("2026-08", "2026-08")).toBe(false);
  });
});

describe("isRevealedToCircle", () => {
  it("un reveal manuel ouvre le mois avant la bascule", () => {
    expect(isRevealedToCircle("2026-07", ["2026-07"], "2026-08")).toBe(true);
    expect(isRevealedToCircle("2026-07", [], "2026-08")).toBe(false);
  });

  it("la bascule automatique ouvre sans reveal manuel", () => {
    expect(isRevealedToCircle("2026-06", [], "2026-08")).toBe(true);
  });
});

describe("autoRevealMonth", () => {
  it("juillet bascule le 1er septembre — année comprise", () => {
    expect(autoRevealMonth("2026-07")).toBe("2026-09");
    expect(autoRevealMonth("2025-12")).toBe("2026-02");
  });
});
