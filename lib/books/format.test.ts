import { describe, expect, it } from "vitest";
import { displayableIssueNumber, formatBookSubtitle } from "./format";

describe("le sous-titre d'une vignette de livre", () => {
  it("compose « Série #N · détail » quand tout est là", () => {
    expect(formatBookSubtitle("Nightwing", "123", "DC")).toBe("Nightwing #123 · DC");
  });

  it("chaque morceau absent disparaît proprement", () => {
    expect(formatBookSubtitle("Nightwing", null, null)).toBe("Nightwing");
    expect(formatBookSubtitle(null, "123", "comics")).toBe("comics");
    expect(formatBookSubtitle(null, null, null)).toBe("");
  });

  it("le marqueur GCD « [nn] » (sans numéro, #58) ne s'affiche jamais — la série seule", () => {
    expect(formatBookSubtitle("Supergirl : Woman of Tomorrow", "[nn]", "comics")).toBe(
      "Supergirl : Woman of Tomorrow · comics",
    );
  });
});

describe("le numéro affichable", () => {
  it("traduit « [nn] » en absence, laisse passer les vrais numéros", () => {
    expect(displayableIssueNumber("[nn]")).toBeNull();
    expect(displayableIssueNumber("123")).toBe("123");
    expect(displayableIssueNumber(null)).toBeNull();
  });
});
