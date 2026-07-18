import { afterEach, describe, expect, it, vi } from "vitest";
import { addMonths, formatDateFrench, formatMonthFrench, isValidIsoDate, localCurrentMonth, localToday } from "./dates";

/**
 * Les dates « calendrier » — tout est arithmétique de chaînes, donc tout est
 * déterministe. Le point sensible : `addMonths` fait du modulo (les passages
 * d'année dans les deux sens), c'est lui qui mérite le plus de cas.
 */

describe("addMonths — l'arithmétique modulo des mois", () => {
  it("avance dans la même année", () => {
    expect(addMonths("2026-03", 4)).toBe("2026-07");
  });

  it("recule dans la même année", () => {
    expect(addMonths("2026-07", -5)).toBe("2026-02");
  });

  it("décembre + 1 passe à janvier de l'année suivante", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
  });

  it("janvier − 1 revient à décembre de l'année précédente", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  it("traverse plusieurs années en avant", () => {
    expect(addMonths("2026-07", 30)).toBe("2029-01");
  });

  it("traverse plusieurs années en arrière (le double modulo protège du négatif)", () => {
    expect(addMonths("2026-02", -26)).toBe("2023-12");
  });

  it("un offset nul rend le mois inchangé", () => {
    expect(addMonths("2026-07", 0)).toBe("2026-07");
  });

  it("garde le zéro de tête des mois à un chiffre", () => {
    expect(addMonths("2026-08", 1)).toBe("2026-09");
    expect(addMonths("2026-10", -1)).toBe("2026-09");
  });
});

describe("isValidIsoDate — le garde des Server Actions", () => {
  it.each(["2026-07-14", "1999-01-01", "2026-12-31"])("accepte %s", (value) => {
    expect(isValidIsoDate(value)).toBe(true);
  });

  it.each([
    ["", "la chaîne vide"],
    ["14/07/2026", "le format français"],
    ["2026-7-14", "un mois sans zéro de tête"],
    ["2026-07", "un mois seul"],
    ["2026-07-14T00:00:00Z", "un timestamp ISO complet"],
    ["demain", "du texte libre"],
  ])("refuse %s (%s)", (value) => {
    expect(isValidIsoDate(value)).toBe(false);
  });

  it("ne borne pas mois et jour — c'est le FORMAT seul (ticket séparé)", () => {
    expect(isValidIsoDate("2026-13-45")).toBe(true);
  });
});

describe("formatDateFrench — découpage pur, sans objet Date", () => {
  it("2026-07-14 → 14/07/2026", () => {
    expect(formatDateFrench("2026-07-14")).toBe("14/07/2026");
  });
});

describe("formatMonthFrench", () => {
  it("2026-07 → juillet 2026", () => {
    expect(formatMonthFrench("2026-07")).toBe("juillet 2026");
  });

  it("couvre les bornes de l'année (janvier et décembre)", () => {
    expect(formatMonthFrench("2026-01")).toBe("janvier 2026");
    expect(formatMonthFrench("2026-12")).toBe("décembre 2026");
  });
});

describe("localToday et localCurrentMonth — la date LOCALE de l'appareil", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rend la date locale au format YYYY-MM-DD, zéros de tête compris", () => {
    vi.useFakeTimers();
    // Construit en heure LOCALE : le test ne dépend pas du fuseau de la machine.
    vi.setSystemTime(new Date(2026, 2, 5, 9, 30));
    expect(localToday()).toBe("2026-03-05");
    expect(localCurrentMonth()).toBe("2026-03");
  });

  it("le 31 décembre à 23 h reste le 31 décembre (pas de bascule UTC)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 11, 31, 23, 0));
    expect(localToday()).toBe("2026-12-31");
    expect(localCurrentMonth()).toBe("2026-12");
  });
});
