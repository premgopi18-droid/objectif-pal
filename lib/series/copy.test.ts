import { describe, expect, it } from "vitest";
import {
  approximateWarning,
  declaredByLabel,
  keepHumanFactLabel,
  knownMaxExceedsLabel,
  knownMaxHint,
  knownMaxSummary,
  overriddenByLabel,
  matchesSeriesFilter,
  nextCardCopy,
  seriesCountsText,
  seriesHeadline,
  seriesToasts,
  suggestedTotal,
} from "./copy";

describe("les textes du suivi de séries", () => {
  it("la ligne de compteurs suit le fait : total, parution en cours, ou « total ? »", () => {
    expect(seriesCountsText({ read: 8, pile: 2, totalVolumes: 12, isOngoing: false, missing: 2 })).toBe("8 lus · 2 dans la pile · 2 pas possédés · sur 12");
    expect(seriesCountsText({ read: 12, pile: 0, totalVolumes: 12, isOngoing: false, missing: 0 })).toBe("12 lus · sur 12");
    expect(seriesCountsText({ read: 1, pile: 0, totalVolumes: null, isOngoing: true, missing: null })).toBe("1 lu · parution en cours");
    expect(seriesCountsText({ read: 3, pile: 0, totalVolumes: null, isOngoing: false, missing: null })).toBe("3 lus · total ?");
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
    const declared = { totalVolumes: 7, isOngoing: false, factDeclaredBy: "u", factDeclaredAt: "2026-09-14T10:00:00Z", factSource: "human" as const, factConfirmedBy: null };
    expect(declaredByLabel(declared, "Léna")).toBe("7 tomes, déclaré par Léna le 14/09/2026");
    expect(declaredByLabel(declared, null)).toBe("7 tomes, déclaré par un membre le 14/09/2026");
    expect(declaredByLabel({ ...declared, totalVolumes: null, isOngoing: true }, "toi")).toContain("parution en cours, déclaré par toi");
    expect(declaredByLabel({ totalVolumes: null, isOngoing: false, factDeclaredBy: null, factDeclaredAt: null, factSource: "human", factConfirmedBy: null }, null)).toBeNull();
    // La validation visible (#317).
    expect(declaredByLabel({ ...declared, factConfirmedBy: "gcd" }, "Léna")).toBe("7 tomes, déclaré par Léna le 14/09/2026, confirmé par GCD");
    expect(declaredByLabel({ ...declared, factConfirmedBy: "anilist" }, "toi")).toContain("confirmé par AniList");
    // Le fait posé par GCD dit sa source, sans pseudo.
    expect(declaredByLabel({ ...declared, totalVolumes: 12, factDeclaredBy: null, factSource: "gcd" }, null)).toBe("12 numéros, série close d'après GCD");
    expect(declaredByLabel({ ...declared, totalVolumes: null, isOngoing: true, factDeclaredBy: null, factSource: "gcd" }, null)).toBe("parution en cours d'après GCD");
    expect(declaredByLabel({ ...declared, totalVolumes: 23, factDeclaredBy: null, factSource: "anilist" }, null)).toBe("23 volumes, série terminée d'après AniList");
    expect(declaredByLabel({ ...declared, totalVolumes: null, isOngoing: true, factDeclaredBy: null, factSource: "anilist" }, null)).toBe("parution en cours d'après AniList");
  });

  it("overriddenByLabel / keepHumanFactLabel — une source a remplacé une déclaration humaine (#317)", () => {
    const overridden = { totalVolumes: 15, isOngoing: false, factSource: "gcd" as const, humanTotalVolumes: 12, humanIsOngoing: false, humanDeclaredAt: "2026-09-14T10:00:00Z" };
    expect(overriddenByLabel(overridden, "Léna")).toBe("Léna avait dit 12 tomes");
    expect(overriddenByLabel(overridden, "toi")).toBe("tu avais dit 12 tomes");
    expect(overriddenByLabel(overridden, null)).toBe("un membre avait dit 12 tomes");
    expect(overriddenByLabel({ ...overridden, humanTotalVolumes: null, humanIsOngoing: true }, "toi")).toBe("tu avais dit parution en cours");
    // Même valeur, ou fait humain, ou pas de déclaration humaine : rien à dire.
    expect(overriddenByLabel({ ...overridden, humanTotalVolumes: 15 }, "toi")).toBeNull();
    expect(overriddenByLabel({ ...overridden, factSource: "human" }, "toi")).toBeNull();
    expect(overriddenByLabel({ ...overridden, humanDeclaredAt: null }, "toi")).toBeNull();
    expect(keepHumanFactLabel({ humanTotalVolumes: 12, humanIsOngoing: false })).toBe("Garder 12");
    expect(keepHumanFactLabel({ humanTotalVolumes: null, humanIsOngoing: true })).toBe("Garder « en cours »");
  });

  it("le stepper part du plus grand plancher, sinon du plus grand possédé (10 au moins)", () => {
    const gcd = (value: number) => ({ source: "gcd" as const, value, label: null });
    expect(suggestedTotal({ knownMax: [gcd(15)], gridMax: 3, readNumbers: [1, 2], pileNumbers: [3] })).toBe(15);
    expect(suggestedTotal({ knownMax: [], gridMax: 3, readNumbers: [1, 2], pileNumbers: [3] })).toBe(10);
    expect(suggestedTotal({ knownMax: [], gridMax: 14, readNumbers: [1], pileNumbers: [14] })).toBe(14);
    // Un plancher plus petit que le possédé ne rabaisse pas la proposition.
    expect(suggestedTotal({ knownMax: [gcd(5)], gridMax: 8, readNumbers: [8], pileNumbers: [] })).toBe(8);
  });

  it("le toast de fusion compte des tomes (lus + pile), pas des « lus » (review #296)", () => {
    expect(seriesToasts.merged("Berserk", 6)).toBe("✓ Séries fusionnées — Berserk : 6 tomes");
    expect(seriesToasts.merged("Berserk", 1)).toBe("✓ Séries fusionnées — Berserk : 1 tome");
  });

  it("les planchers sont dits comme des planchers, par source et par édition (#299)", () => {
    expect(knownMaxHint([{ source: "gcd", value: 108, label: null }])).toBe("108 numéros parus d'après GCD (au moins).");
    expect(knownMaxHint([{ source: "bnf", value: 111, label: "Glénat" }, { source: "gcd", value: 40, label: null }])).toBe(
      "111 tomes déposés à la BnF pour l'édition Glénat · 40 numéros parus d'après GCD (au moins).",
    );
    expect(knownMaxHint([{ source: "bnf", value: 7, label: null }])).toBe("7 tomes déposés à la BnF pour l'édition française.");
    expect(knownMaxHint([])).toBe("Aucune source ne connaît cette série : à toi de dire.");
    expect(knownMaxHint([], { category: "bd", publisher: "Dargaud" })).toBe("Aucune source ne connaît cette série : à toi de dire.");
    expect(knownMaxHint([], { category: "roman", publisher: "Lorestone (Paris)" })).toBe(
      "Aucune source ne connaît cette série (aucune source ouverte ne décrit les parutions françaises des romans) : à toi de dire.",
    );
    expect(knownMaxHint([], { category: "comics", publisher: "Panini comics (Nice)" })).toBe(
      "Aucune source ne connaît cette série (GCD n'indexe pas les parutions Panini) : à toi de dire.",
    );
    // Un plancher connu : la raison n'a plus lieu d'être.
    expect(knownMaxHint([{ source: "gcd", value: 2, label: null }], { category: "comics", publisher: "Panini" })).toBe("2 numéros parus d'après GCD (au moins).");
  });

  it("knownMaxSummary — la ligne de la fiche, rien sans plancher (#307)", () => {
    expect(knownMaxSummary([])).toBeNull();
    expect(knownMaxSummary([{ source: "gcd", value: 2, label: null }])).toBe("2 numéros parus d'après GCD (au moins).");
    expect(knownMaxExceedsLabel({ source: "bnf", value: 112, label: "Glénat" })).toBe("La BnF en connaît 112.");
    expect(knownMaxExceedsLabel({ source: "gcd", value: 15, label: null })).toBe("GCD en connaît 15.");
  });
});
