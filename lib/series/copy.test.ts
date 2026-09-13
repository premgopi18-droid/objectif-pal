import { describe, expect, it } from "vitest";
import {
  approximateWarning,
  declaredByLabel,
  gcdHintText,
  matchesSeriesFilter,
  nextCardCopy,
  seriesCountsText,
  seriesHeadline,
  suggestedTotal,
} from "./copy";

describe("les textes du suivi de séries", () => {
  it("la ligne de compteurs suit le fait : total, parution en cours, ou « total ? »", () => {
    expect(seriesCountsText({ read: 8, pile: 2, totalVolumes: 12, isOngoing: false })).toBe("8 lus · 2 dans la pile · sur 12");
    expect(seriesCountsText({ read: 1, pile: 0, totalVolumes: null, isOngoing: true })).toBe("1 lu · parution en cours");
    expect(seriesCountsText({ read: 3, pile: 0, totalVolumes: null, isOngoing: false })).toBe("3 lus · total ?");
  });

  it("le bandeau de synthèse accorde séries et tomes", () => {
    expect(seriesHeadline(1, 1)).toBe("1 série · dette totale : 1 tome à lire");
    expect(seriesHeadline(4, 7)).toBe("4 séries · dette totale : 7 tomes à lire");
    expect(seriesHeadline(2, 0)).toBe("2 séries · rien à lire dans la pile");
  });

  it("« En cours » regroupe ce qui reste à lire OU à renseigner", () => {
    expect(matchesSeriesFilter("unknown-total", "in-progress")).toBe(true);
    expect(matchesSeriesFilter("approximate", "in-progress")).toBe(true);
    expect(matchesSeriesFilter("complete", "in-progress")).toBe(false);
    expect(matchesSeriesFilter("complete", "all")).toBe(true);
  });

  it("la carte suivante a ses quatre formes", () => {
    expect(nextCardCopy({ kind: "read-next", number: 9, bookId: "b" }, 12).title).toBe("À lire ensuite : tome 9");
    expect(nextCardCopy({ kind: "missing", number: 4 }, 10)).toMatchObject({ tone: "buy", title: "Il te manque le tome 4" });
    expect(nextCardCopy({ kind: "up-to-date" }, null).tone).toBe("calm");
    expect(nextCardCopy({ kind: "complete" }, 7).body).toBe("Les 7 tomes sont lus. Chapeau.");
  });

  it("l'avertissement « approximatif » s'accorde", () => {
    expect(approximateWarning(1)).toContain("1 tome lu sans numéro");
    expect(approximateWarning(2)).toContain("2 tomes lus sans numéro");
  });

  it("l'auteur du fait : toi, un ami par son pseudo, sinon « un membre » — rien sans fait", () => {
    const declared = { totalVolumes: 7, isOngoing: false, factDeclaredBy: "u", factDeclaredAt: "2026-09-14T10:00:00Z" };
    expect(declaredByLabel(declared, "Léna")).toBe("7 tomes, déclaré par Léna le 14/09");
    expect(declaredByLabel(declared, null)).toBe("7 tomes, déclaré par un membre le 14/09");
    expect(declaredByLabel({ ...declared, totalVolumes: null, isOngoing: true }, "toi")).toContain("parution en cours, déclaré par toi");
    expect(declaredByLabel({ totalVolumes: null, isOngoing: false, factDeclaredBy: null, factDeclaredAt: null }, null)).toBeNull();
  });

  it("le stepper part de l'indice GCD, sinon du plus grand possédé (10 au moins)", () => {
    expect(suggestedTotal({ gcdKnownMax: 15, gridMax: 3, readNumbers: [1, 2], pileNumbers: [3] })).toBe(15);
    expect(suggestedTotal({ gcdKnownMax: null, gridMax: 3, readNumbers: [1, 2], pileNumbers: [3] })).toBe(10);
    expect(suggestedTotal({ gcdKnownMax: null, gridMax: 14, readNumbers: [1], pileNumbers: [14] })).toBe(14);
    // Un indice GCD plus petit que le possédé ne rabaisse pas la proposition.
    expect(suggestedTotal({ gcdKnownMax: 5, gridMax: 8, readNumbers: [8], pileNumbers: [] })).toBe(8);
  });

  it("l'indice GCD est dit comme un plancher, jamais comme une vérité", () => {
    expect(gcdHintText(108)).toBe("108 numéros parus d'après GCD (au moins).");
    expect(gcdHintText(null)).toBe("GCD ne connaît pas cette série.");
  });
});
