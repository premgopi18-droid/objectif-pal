import { describe, expect, it } from "vitest";
import type { GcdLiveSeries } from "@/lib/resolution/providers/gcd-live";
import { CLOSED_RECHECK_DAYS, liveRunExitCode, selectLiveTargets, seriesPatchFrom, type LiveTarget } from "./series-gcd-live-plan.mjs";

const target = (gcdId: number, overrides: Partial<LiveTarget> = {}): LiveTarget => ({
  gcdId,
  name: `S${gcdId}`,
  isCurrent: true,
  yearEnded: null,
  issueCount: 2,
  lastNumber: 2,
  liveCheckedAt: null,
  ...overrides,
});

const now = new Date("2026-09-14T06:30:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

describe("selectLiveTargets — en cours d'abord, closes une fois par mois, bornées au budget d'appels", () => {
  it("les en cours jamais relues, puis les plus anciennes ; une close relue il y a 10 jours attend", () => {
    const picked = selectLiveTargets(
      [
        target(1, { liveCheckedAt: daysAgo(1) }),
        target(2, { isCurrent: false, yearEnded: 2015, liveCheckedAt: daysAgo(10) }),
        target(3, { liveCheckedAt: null }),
        target(4, { isCurrent: false, yearEnded: 2016, liveCheckedAt: daysAgo(CLOSED_RECHECK_DAYS + 1) }),
        target(5, { isCurrent: false, yearEnded: null, liveCheckedAt: daysAgo(3) }),
        target(6, { isCurrent: false, yearEnded: 2010, liveCheckedAt: null }),
      ],
      now,
    );
    // 3 (en cours, jamais relue), 5 (fin inconnue = ouverte, il y a 3 j), 1 (hier), puis les closes : 6 (jamais relue), 4 (> 30 j) ; 2 attend.
    expect(picked.map((entry) => entry.gcdId)).toEqual([3, 5, 1, 6, 4]);
  });

  it("coupe au plafond", () => {
    expect(selectLiveTargets([target(1), target(2), target(3)], now, 2)).toHaveLength(2);
  });
});

describe("seriesPatchFrom — ce que l'API change, et rien d'autre", () => {
  const live = (overrides: Partial<GcdLiveSeries> = {}): GcdLiveSeries => ({
    name: "S",
    yearBegan: 2025,
    yearEnded: null,
    issueIds: [1, 2, 3],
    lastNumber: 3,
    issueCount: 3,
    ...overrides,
  });

  it("un tome de plus : compte et dernier numéro montent", () => {
    expect(seriesPatchFrom({ isCurrent: true, yearEnded: null, issueCount: 2, lastNumber: 2 }, live())).toEqual({ issue_count: 3, last_number: 3 });
  });

  it("rien ne bouge → patch vide", () => {
    expect(seriesPatchFrom({ isCurrent: true, yearEnded: null, issueCount: 3, lastNumber: 3 }, live())).toEqual({});
  });

  it("une fin apparaît : year_ended posé, is_current passe à false — jamais l'inverse", () => {
    expect(seriesPatchFrom({ isCurrent: true, yearEnded: null, issueCount: 3, lastNumber: 3 }, live({ yearEnded: 2026 }))).toEqual({
      year_ended: 2026,
      is_current: false,
    });
    // Close chez nous, sans fin chez GCD : on ne devine pas une reprise.
    expect(seriesPatchFrom({ isCurrent: false, yearEnded: 2015, issueCount: 3, lastNumber: 3 }, live({ yearEnded: null }))).toEqual({ year_ended: null });
  });

  it("le dernier numéro ne descend jamais, et un dernier numéro inconnu chez GCD ne l'efface pas", () => {
    expect(seriesPatchFrom({ isCurrent: true, yearEnded: null, issueCount: 3, lastNumber: 25 }, live({ lastNumber: 3 }))).toEqual({});
    expect(seriesPatchFrom({ isCurrent: true, yearEnded: null, issueCount: 3, lastNumber: 25 }, live({ lastNumber: null }))).toEqual({});
    expect(seriesPatchFrom({ isCurrent: true, yearEnded: null, issueCount: 3, lastNumber: null }, live({ lastNumber: 3 }))).toEqual({ last_number: 3 });
  });
});

describe("liveRunExitCode — rouge si rien ne répond, ou sur erreur de notre côté", () => {
  const counts = { targets: 10, calls: 12, answered: 9, updated: 2, issuesAdded: 1, gone: 1, quotaHit: false, networkErrors: 1, infraErrors: 0 };
  it("verdicts", () => {
    expect(liveRunExitCode(counts)).toBe(0);
    expect(liveRunExitCode({ ...counts, answered: 0, networkErrors: 10 })).toBe(1);
    expect(liveRunExitCode({ ...counts, infraErrors: 1 })).toBe(1);
    expect(liveRunExitCode({ ...counts, targets: 0, answered: 0 })).toBe(0);
    // Le quota partagé par IP peut être déjà consommé au premier appel : pas une panne.
    expect(liveRunExitCode({ ...counts, calls: 1, answered: 0, networkErrors: 0, quotaHit: true })).toBe(0);
  });
});
