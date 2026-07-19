import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addMonths,
  daysBetween,
  formatDateFrench,
  formatMonthFrench,
  isValidIsoDate,
  localCurrentMonth,
  localToday,
  monthsBetween,
} from "./dates";

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
  it.each(["2026-07-14", "1999-01-01", "2026-12-31", "2024-02-29"])("accepte %s", (value) => {
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

  it.each([
    ["2026-13-45", "un mois et un jour hors bornes"],
    ["2026-02-30", "le 30 février"],
    ["2026-02-29", "le 29 février d'une année non bissextile"],
    ["2026-00-10", "un mois zéro"],
    ["2026-01-00", "un jour zéro"],
  ])("borne le calendrier — refuse %s (%s)", (value) => {
    expect(isValidIsoDate(value)).toBe(false);
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

describe("daysBetween — la différence en jours, sans piège de fuseau", () => {
  it("compte les jours d'un intervalle simple", () => {
    expect(daysBetween("2026-07-01", "2026-07-11")).toBe(10);
  });

  it("le même jour vaut zéro", () => {
    expect(daysBetween("2026-07-05", "2026-07-05")).toBe(0);
  });

  it("un intervalle inversé est négatif (au consommateur d'en décider)", () => {
    expect(daysBetween("2026-07-11", "2026-07-01")).toBe(-10);
  });

  it("traverse un changement de mois", () => {
    expect(daysBetween("2026-06-28", "2026-07-02")).toBe(4);
  });

  it("traverse un 29 février (année bissextile)", () => {
    expect(daysBetween("2024-02-27", "2024-03-01")).toBe(3);
  });

  it("traverse une année non bissextile", () => {
    expect(daysBetween("2025-02-27", "2025-03-01")).toBe(2);
  });

  it("traverse un changement d'heure d'été sans perdre ni gagner un jour", () => {
    // Dernier dimanche de mars 2026 : le calcul est en UTC des deux côtés.
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
  });

  it("traverse une année entière", () => {
    expect(daysBetween("2025-07-19", "2026-07-19")).toBe(365);
  });
});

describe("monthsBetween — les mois calendaires couverts, bornes comprises", () => {
  it("le même mois en couvre un", () => {
    expect(monthsBetween("2026-07", "2026-07")).toBe(1);
  });

  it("mai → juillet en couvre trois", () => {
    expect(monthsBetween("2026-05", "2026-07")).toBe(3);
  });

  it("traverse le passage d'année", () => {
    expect(monthsBetween("2025-11", "2026-02")).toBe(4);
  });

  it("un intervalle inversé rend un compte nul ou négatif", () => {
    expect(monthsBetween("2026-07", "2026-06")).toBe(0);
    expect(monthsBetween("2026-07", "2026-05")).toBe(-1);
  });
});
