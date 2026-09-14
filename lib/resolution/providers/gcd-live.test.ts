import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ProviderUnavailableError } from "@/lib/resolution/types";
import { createGcdLiveProvider, numericIssueNumber, parseGcdIssue, parseGcdSeries } from "./gcd-live";

/** Réponses réelles de l'API comics.org, capturées le 14/09/2026 (#308). */
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/gcd/${name}.json`, import.meta.url), "utf8"));

describe("numericIssueNumber — la règle de l'export et de la RPC (cinq chiffres au plus)", () => {
  it("garde un entier, rejette le reste", () => {
    expect(numericIssueNumber("2")).toBe(2);
    expect(numericIssueNumber("0")).toBe(0);
    expect(numericIssueNumber(" 25 ")).toBe(25);
    expect(numericIssueNumber("[nn]")).toBeNull();
    expect(numericIssueNumber("20.1")).toBeNull();
    expect(numericIssueNumber("Annual 1")).toBeNull();
    expect(numericIssueNumber("123456")).toBeNull();
    expect(numericIssueNumber(null)).toBeNull();
    expect(numericIssueNumber(undefined)).toBeNull();
  });
});

describe("parseGcdSeries — la série telle que l'API la sert", () => {
  it("Absolute Superman (Urban) : en cours, 2 fascicules, dernier numéro 2", () => {
    expect(parseGcdSeries(fixture("series-225232-absolute-superman"))).toEqual({
      name: "Absolute Superman",
      yearBegan: 2025,
      yearEnded: null,
      issueIds: [2749634, 2831799],
      lastNumber: 2,
      issueCount: 2,
    });
  });

  it("Batwoman (Urban) : close en 2015, numéros 0..4 → dernier 4", () => {
    expect(parseGcdSeries(fixture("series-68109-batwoman"))).toMatchObject({ yearEnded: 2015, lastNumber: 4, issueCount: 5 });
  });

  it("Fables (Urban) : 11 fascicules indexés mais le dernier numéro est 25 — le total, pas le compte", () => {
    expect(parseGcdSeries(fixture("series-70330-fables"))).toMatchObject({ yearEnded: 2016, lastNumber: 25, issueCount: 11 });
  });

  it("le plus grand numéro numérique, pas le dernier de la liste : un « [nn] » en fin de liste n'efface rien", () => {
    expect(
      parseGcdSeries({ name: "X", active_issues: [], issue_descriptors: ["1 - a", "2 - b", "[nn] - spécial"], year_began: 2020, year_ended: null }),
    ).toMatchObject({ lastNumber: 2, issueCount: 0 });
    expect(parseGcdSeries({ name: "X", active_issues: [], issue_descriptors: ["[nn]"], year_began: 2020, year_ended: null })).toMatchObject({ lastNumber: null });
  });

  it("rien sans nom, rien pour un JSON qui n'est pas une série", () => {
    expect(parseGcdSeries({ name: "" })).toBeNull();
    expect(parseGcdSeries("Page not found")).toBeNull();
    expect(parseGcdSeries(null)).toBeNull();
  });
});

describe("parseGcdIssue — le fascicule normalisé comme l'export", () => {
  it("Absolute Superman 2 : ISBN sans tirets, code-barres, pages entières, série", () => {
    expect(parseGcdIssue(fixture("issue-2831799-absolute-superman-2"))).toEqual({
      gcdId: 2831799,
      seriesId: 225232,
      number: "2",
      title: "Le fils du démon",
      keyDate: "2026-04-10",
      isbn: "9791026824091",
      barcodes: ["9791026824091"],
      pageCount: 232,
    });
  });

  it("plusieurs codes séparés par « ; » ou espace → une ligne par code ; un code trop court est ignoré", () => {
    expect(parseGcdIssue({ api_url: "https://www.comics.org/api/issue/1/", barcode: "9791026824091; 0123456789012 12" })?.barcodes).toEqual([
      "9791026824091",
      "0123456789012",
    ]);
  });

  it("sans identifiant, rien ; sans ISBN ni code, des champs nuls (le job décide)", () => {
    expect(parseGcdIssue({ number: "1" })).toBeNull();
    expect(parseGcdIssue({ api_url: "https://www.comics.org/api/issue/7/", isbn: "", barcode: "", page_count: "" })).toMatchObject({
      gcdId: 7,
      isbn: null,
      barcodes: [],
      pageCount: null,
      seriesId: null,
    });
  });
});

describe("createGcdLiveProvider — panne ≠ absence", () => {
  const providerAnswering = (status: number, body: unknown = {}) =>
    createGcdLiveProvider(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

  it("404 = la série n'existe plus → null", async () => {
    await expect(providerAnswering(404).getSeries(1)).resolves.toBeNull();
  });

  it("403 (Cloudflare), 429, 5xx → ProviderUnavailableError, jamais null", async () => {
    for (const status of [403, 429, 500, 503]) {
      await expect(providerAnswering(status).getSeries(1)).rejects.toBeInstanceOf(ProviderUnavailableError);
    }
  });

  it("200 → la série parsée, avec l'URL JSON et notre User-Agent", async () => {
    const calls: { url: string; userAgent: string | null }[] = [];
    const provider = createGcdLiveProvider(async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), userAgent: headers.get("User-Agent") });
      return new Response(JSON.stringify(fixture("series-225232-absolute-superman")), { status: 200 });
    });
    await expect(provider.getSeries(225232)).resolves.toMatchObject({ name: "Absolute Superman" });
    expect(calls[0]?.url).toBe("https://www.comics.org/api/series/225232/?format=json");
    expect(calls[0]?.userAgent).toContain("objectif-pal");
  });
});
