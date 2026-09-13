import { describe, expect, it } from "vitest";
import { parseVolumeNumber } from "./volume-number";

describe("parseVolumeNumber — le numéro de tome canonique ou rien", () => {
  it.each([
    // Les formes mesurées sur 88 notices BnF (13/09/2026).
    ["18", "18"],
    ["02", "2"],
    ["Tome 1", "1"],
    ["[Tome 1]", "1"],
    ["Volume 02", "2"],
    ["[Volume 7]", "7"],
    ["vol. 2", "2"],
    ["t 6", "6"],
    ["T02", "2"],
    ["tome I", "1"],
    ["tome IV", "4"],
    ["volume deux", "2"],
    ["[Volume deux]", "2"],
    ["[Quatrième volume]", "4"],
    ["[Cinquième volume]", "5"],
    ["chapitre premier", "1"],
    ["Livre 2", "2"],
    ["dix-sept", "17"],
    // Les mots en « t » ne sont pas un préfixe « t. » + rien (review #294).
    ["trois", "3"],
    ["treize", "13"],
    ["troisième", "3"],
    ["t. trois", "3"],
    ["n° 3", "3"],
    ["#4", "4"],
    ["[3]", "3"],
    ["  12.  ", "12"],
    ["0", "0"],
  ])("reconnaît « %s » → %s", (raw, expected) => {
    expect(parseVolumeNumber(raw)).toBe(expected);
  });

  it.each([
    // Un tome faux serait pire qu'un tome absent : tout ce qui est ambigu tombe.
    "[nn]",
    "41 (842)",
    "10/2020",
    "1990-1991",
    "4 Pre-Order Edition",
    "Chaos éd.",
    "DL 2023",
    "tome",
    "vingt-et-un",
    "MMXX",
    // Des suites de lettres romaines qui ne sont pas des romains (review #294).
    "il",
    "vv",
    "iiii",
    "XL",
    "",
    "   ",
  ])("rejette « %s »", (raw) => {
    expect(parseVolumeNumber(raw)).toBeNull();
  });

  it("null et undefined donnent null sans jeter", () => {
    expect(parseVolumeNumber(null)).toBeNull();
    expect(parseVolumeNumber(undefined)).toBeNull();
  });
});
