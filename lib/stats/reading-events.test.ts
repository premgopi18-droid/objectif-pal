import { describe, expect, it } from "vitest";
import { summarizeReadingEvents, type ReadingEventFact } from "./reading-events";

/**
 * L'agrégation du journal d'états (prérequis du lot A de #30). Un test = une
 * trajectoire de lecteur. Rappel du contrat : le premier `reading` d'une lecture
 * est un DÉBUT (jamais compté) ; les `reading` suivants sont des reprises. Le
 * classement suit l'ordre d'insertion (`id`), le mois vient d'`occurred_at`.
 */

let eventCounter = 0;

function event(status: ReadingEventFact["status"], occurredAt: string, readingId: string): ReadingEventFact {
  eventCounter += 1;
  return { id: eventCounter, readingId, status, occurredAt };
}

/** Un timestamptz ISO au jour donné, comme le rend PostgREST (UTC). */
const at = (isoDate: string) => `${isoDate}T00:00:00+00:00`;

describe("summarizeReadingEvents", () => {
  it("ne compte rien sur un journal vide", () => {
    expect(summarizeReadingEvents([])).toEqual({ abandonsByMonth: {}, resumptionsByMonth: {} });
  });

  it("ne compte pas le premier `reading` (c'est un début, pas une reprise)", () => {
    const summary = summarizeReadingEvents([event("reading", at("2026-07-01"), "r1")]);
    expect(summary).toEqual({ abandonsByMonth: {}, resumptionsByMonth: {} });
  });

  it("compte un abandon dans le mois de son occurred_at", () => {
    const summary = summarizeReadingEvents([
      event("reading", at("2026-06-10"), "r1"),
      event("abandoned", at("2026-07-05"), "r1"),
    ]);
    expect(summary.abandonsByMonth).toEqual({ "2026-07": 1 });
    expect(summary.resumptionsByMonth).toEqual({});
  });

  it("compte une reprise : début → abandon → reprise (le 2e `reading`)", () => {
    const summary = summarizeReadingEvents([
      event("reading", at("2026-05-01"), "r1"),
      event("abandoned", at("2026-05-20"), "r1"),
      event("reading", at("2026-07-02"), "r1"),
    ]);
    expect(summary.abandonsByMonth).toEqual({ "2026-05": 1 });
    expect(summary.resumptionsByMonth).toEqual({ "2026-07": 1 });
  });

  it("traite une réouverture (finished → reading) comme une reprise", () => {
    const summary = summarizeReadingEvents([
      event("reading", at("2026-07-01"), "r1"),
      event("finished", at("2026-07-10"), "r1"),
      event("reading", at("2026-07-15"), "r1"),
    ]);
    expect(summary.resumptionsByMonth).toEqual({ "2026-07": 1 });
    expect(summary.abandonsByMonth).toEqual({});
  });

  it("agrège plusieurs lectures et plusieurs mois", () => {
    const summary = summarizeReadingEvents([
      // r1 : début, abandon juillet, reprise juillet
      event("reading", at("2026-06-01"), "r1"),
      event("abandoned", at("2026-07-03"), "r1"),
      event("reading", at("2026-07-04"), "r1"),
      // r2 : début, abandon juillet
      event("reading", at("2026-07-01"), "r2"),
      event("abandoned", at("2026-07-20"), "r2"),
      // r3 : début, abandon août, reprise août
      event("reading", at("2026-08-01"), "r3"),
      event("abandoned", at("2026-08-05"), "r3"),
      event("reading", at("2026-08-09"), "r3"),
    ]);
    expect(summary.abandonsByMonth).toEqual({ "2026-07": 2, "2026-08": 1 });
    expect(summary.resumptionsByMonth).toEqual({ "2026-07": 1, "2026-08": 1 });
  });

  it("s'appuie sur `id` (ordre d'insertion), pas sur l'ordre du tableau", () => {
    // Les mêmes événements que « début → abandon → reprise », désordonnés.
    const start = event("reading", at("2026-05-01"), "r1");
    const abandon = event("abandoned", at("2026-05-20"), "r1");
    const resume = event("reading", at("2026-07-02"), "r1");
    const summary = summarizeReadingEvents([resume, start, abandon]);
    expect(summary.resumptionsByMonth).toEqual({ "2026-07": 1 });
    expect(summary.abandonsByMonth).toEqual({ "2026-05": 1 });
  });

  it("ne mute pas le tableau d'entrée", () => {
    const events = [event("abandoned", at("2026-07-05"), "r1"), event("reading", at("2026-07-01"), "r1")];
    const snapshot = [...events];
    summarizeReadingEvents(events);
    expect(events).toEqual(snapshot);
  });
});
