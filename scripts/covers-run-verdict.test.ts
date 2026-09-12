import { describe, expect, it } from "vitest";
import { CoverFailure, classifyFailure, shouldFailRun } from "./covers-run-verdict.mjs";

describe("shouldFailRun — le verdict du run Covers (#272)", () => {
  it("vert quand tout est rapatrié", () => {
    expect(shouldFailRun({ internalized: 12, corpse: 0, network: 0, infra: 0 })).toBe(false);
  });

  it("vert quand la file n'a plus que des cadavres — le cas #270 (29 fantômes, 0 rapatriée)", () => {
    expect(shouldFailRun({ internalized: 0, corpse: 29, network: 0, infra: 0 })).toBe(false);
  });

  it("vert sur des cadavres mêlés à quelques erreurs réseau : un timeout isolé n'est pas une panne", () => {
    expect(shouldFailRun({ internalized: 0, corpse: 28, network: 1, infra: 0 })).toBe(false);
  });

  it("vert quand au moins une couverture passe malgré des erreurs réseau", () => {
    expect(shouldFailRun({ internalized: 1, corpse: 0, network: 40, infra: 0 })).toBe(false);
  });

  it("rouge sur panne réseau totale : rien de rapatrié, aucune réponse HTTP", () => {
    expect(shouldFailRun({ internalized: 0, corpse: 0, network: 3, infra: 0 })).toBe(true);
  });

  it("rouge dès UNE erreur d'infra (bucket, base), même si le reste passe", () => {
    expect(shouldFailRun({ internalized: 40, corpse: 2, network: 0, infra: 1 })).toBe(true);
  });

  it("vert sur un run sans rien à faire (file vide ou hôtes inconnus seulement)", () => {
    expect(shouldFailRun({ internalized: 0, corpse: 0, network: 0, infra: 0 })).toBe(false);
  });
});

describe("classifyFailure", () => {
  it("une CoverFailure porte sa famille", () => {
    expect(classifyFailure(new CoverFailure("corpse", "HTTP 404"))).toBe("corpse");
    expect(classifyFailure(new CoverFailure("network", "fetch failed"))).toBe("network");
    expect(classifyFailure(new CoverFailure("infra", "upload : bucket"))).toBe("infra");
  });

  it("l'inattendu est de l'infra — jamais rangé en silence chez les cadavres", () => {
    expect(classifyFailure(new TypeError("boom"))).toBe("infra");
    expect(classifyFailure("pas une erreur")).toBe("infra");
  });
});
