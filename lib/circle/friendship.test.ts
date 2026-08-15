import { describe, expect, it } from "vitest";
import {
  canonicalPair,
  classifyExistingForRequest,
  normalizeSearchPrefix,
  splitCircleLinks,
  toCircleLink,
} from "./friendship";

const ME = "aaaaaaaa-0000-0000-0000-000000000001";
const OTHER = "bbbbbbbb-0000-0000-0000-000000000002";
const THIRD = "cccccccc-0000-0000-0000-000000000003";

describe("canonicalPair", () => {
  it("ordonne la paire quel que soit le sens d'appel", () => {
    expect(canonicalPair(ME, OTHER)).toEqual({ userLow: ME, userHigh: OTHER });
    expect(canonicalPair(OTHER, ME)).toEqual({ userLow: ME, userHigh: OTHER });
  });

  it("refuse de se lier à soi-même", () => {
    expect(canonicalPair(ME, ME)).toBeNull();
  });
});

describe("toCircleLink", () => {
  it("désigne l'autre bout de la paire, des deux côtés", () => {
    const row = { user_low: ME, user_high: OTHER, requester_id: ME, status: "pending" };
    expect(toCircleLink(row, ME)).toEqual({ otherId: OTHER, requestedByMe: true, status: "pending" });
    expect(toCircleLink(row, OTHER)).toEqual({ otherId: ME, requestedByMe: false, status: "pending" });
  });

  it("rejette une ligne où je ne figure pas, et un statut inconnu", () => {
    expect(toCircleLink({ user_low: OTHER, user_high: THIRD, requester_id: OTHER, status: "pending" }, ME)).toBeNull();
    expect(toCircleLink({ user_low: ME, user_high: OTHER, requester_id: ME, status: "blocked" }, ME)).toBeNull();
  });
});

describe("splitCircleLinks", () => {
  it("répartit amis / demandes reçues / demandes envoyées", () => {
    const rows = [
      // OTHER et moi : amis.
      { user_low: ME, user_high: OTHER, requester_id: OTHER, status: "accepted" },
      // THIRD m'a demandé : reçue.
      { user_low: ME, user_high: THIRD, requester_id: THIRD, status: "pending" },
    ];
    expect(splitCircleLinks(rows, ME)).toEqual({
      friendIds: [OTHER],
      receivedIds: [THIRD],
      sentIds: [],
    });
    // Vu de THIRD, la même demande est « envoyée ».
    expect(splitCircleLinks(rows, THIRD)).toEqual({
      friendIds: [],
      receivedIds: [],
      sentIds: [ME],
    });
  });
});

describe("classifyExistingForRequest", () => {
  it("la demande croisée devient acceptation (§4.14)", () => {
    expect(classifyExistingForRequest({ otherId: OTHER, requestedByMe: false, status: "pending" })).toBe("autoAccept");
  });

  it("re-demander ne casse rien : déjà envoyée, déjà amis", () => {
    expect(classifyExistingForRequest({ otherId: OTHER, requestedByMe: true, status: "pending" })).toBe("alreadySent");
    expect(classifyExistingForRequest({ otherId: OTHER, requestedByMe: true, status: "accepted" })).toBe("alreadyFriends");
    expect(classifyExistingForRequest({ otherId: OTHER, requestedByMe: false, status: "accepted" })).toBe("alreadyFriends");
  });
});

describe("normalizeSearchPrefix", () => {
  it("borne : deux caractères minimum, après trim", () => {
    expect(normalizeSearchPrefix("  lé  ")).toBe("lé");
    expect(normalizeSearchPrefix("l")).toBeNull();
    expect(normalizeSearchPrefix("  l ")).toBeNull();
    expect(normalizeSearchPrefix("")).toBeNull();
  });
});
