import { describe, expect, it } from "vitest";
import { isOrphan } from "./maintenance-verdict.mjs";

const cutoffMs = Date.parse("2026-09-06T00:00:00Z");

describe("isOrphan — la décision de la purge (#205, #278)", () => {
  it("un objet ancien et non référencé est orphelin", () => {
    expect(isOrphan({ path: "user-1/x.webp", createdAt: "2026-08-01T00:00:00Z", referenced: new Set(), cutoffMs })).toBe(true);
  });

  it("référencé par un livre, une inbox en attente ou une contribution partagée : gardé", () => {
    const referenced = new Set(["user-1/x.webp", "shared/9782070342266/abc.webp"]);
    expect(isOrphan({ path: "user-1/x.webp", createdAt: "2026-08-01T00:00:00Z", referenced, cutoffMs })).toBe(false);
    expect(isOrphan({ path: "shared/9782070342266/abc.webp", createdAt: "2026-08-01T00:00:00Z", referenced, cutoffMs })).toBe(false);
  });

  it("trop récent : gardé même sans référence (marge de sécurité)", () => {
    expect(isOrphan({ path: "user-1/inbox-abc.webp", createdAt: "2026-09-12T00:00:00Z", referenced: new Set(), cutoffMs })).toBe(false);
  });

  it("date illisible : la marge ne protège pas", () => {
    expect(isOrphan({ path: "user-1/x.webp", createdAt: undefined, referenced: new Set(), cutoffMs })).toBe(true);
  });
});
