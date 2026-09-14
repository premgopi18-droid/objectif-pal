import { describe, expect, it, vi } from "vitest";
import { createAniListProvider, factFromAniList, matchAniListStrict, type AniListMedia } from "./anilist";

const media = (overrides: Partial<AniListMedia>): AniListMedia => ({
  id: 1,
  titles: ["Dorohedoro"],
  status: "FINISHED",
  volumes: 23,
  format: "MANGA",
  countryOfOrigin: "JP",
  ...overrides,
});

describe("matchAniListStrict — jamais le premier résultat, un titre exact", () => {
  it("reconnaît le titre exact, casse et accents à part", () => {
    expect(matchAniListStrict("dorohedoro", [media({})])?.id).toBe(1);
  });

  it("reconnaît un titre VF par ses synonymes (« En selle, Sakamichi ! » → Yowamushi Pedal)", () => {
    const yowamushi = media({ id: 7, titles: ["Yowamushi Pedal", "En selle, Sakamichi !"] });
    expect(matchAniListStrict("En selle, Sakamichi !", [media({ id: 9, titles: ["Autre"] }), yowamushi])?.id).toBe(7);
  });

  it("une édition spéciale n'est pas rapprochée — son découpage diffère (voulu)", () => {
    expect(matchAniListStrict("L'Attaque des Titans - Édition Colossale", [media({ titles: ["Attack on Titan", "L'Attaque des Titans"] })])).toBeNull();
  });

  it("écarte ce qui n'est pas un manga d'origine asiatique (Lastman, Radiant : des œuvres françaises)", () => {
    expect(matchAniListStrict("Lastman", [media({ titles: ["LASTMAN"], countryOfOrigin: "JP", format: "MANGA" })])?.id).toBe(1);
    expect(matchAniListStrict("Radiant", [media({ titles: ["Radiant"], countryOfOrigin: "FR" })])).toBeNull();
    expect(matchAniListStrict("Dorohedoro", [media({ format: "ONE_SHOT" })])).toBeNull();
  });

  it("un nom vide ne matche rien", () => {
    expect(matchAniListStrict("  ", [media({ titles: [""] })])).toBeNull();
  });
});

describe("factFromAniList — ce que l'œuvre dit du fait", () => {
  it("terminé avec volumes → total ; en cours → parution en cours ; le reste → rien", () => {
    expect(factFromAniList(media({}))).toEqual({ totalVolumes: 23 });
    expect(factFromAniList(media({ status: "RELEASING", volumes: null }))).toEqual({ isOngoing: true });
    expect(factFromAniList(media({ status: "FINISHED", volumes: null }))).toBeNull();
    expect(factFromAniList(media({ status: "HIATUS", volumes: 5 }))).toBeNull();
    expect(factFromAniList(media({ status: "CANCELLED", volumes: 5 }))).toBeNull();
  });
});

describe("le provider AniList", () => {
  const page = { data: { Page: { media: [{ id: 42, title: { romaji: "Dorohedoro", english: "Dorohedoro", native: "ドロヘドロ" }, synonyms: [], status: "FINISHED", volumes: 23, format: "MANGA", countryOfOrigin: "JP" }] } } };

  it("recherche en GraphQL avec l'identité de l'app et aplatit titres + synonymes", async () => {
    const fetchImplementation = vi.fn(async () => new Response(JSON.stringify(page), { status: 200 }));
    const provider = createAniListProvider(fetchImplementation as unknown as typeof fetch);
    const results = await provider.searchManga("Dorohedoro");
    expect(results[0]).toMatchObject({ id: 42, titles: ["Dorohedoro", "Dorohedoro", "ドロヘドロ"], status: "FINISHED", volumes: 23 });
    const [, init] = fetchImplementation.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["User-Agent"]).toContain("objectif-pal");
    expect(String(init.body)).toContain('"search":"Dorohedoro"');
  });

  it("une réponse en erreur jette (panne ≠ absence)", async () => {
    const provider = createAniListProvider((async () => new Response("", { status: 429 })) as unknown as typeof fetch);
    await expect(provider.searchManga("x")).rejects.toThrow("HTTP 429");
    const withErrors = createAniListProvider((async () => new Response(JSON.stringify({ errors: [{ message: "Too Many Requests" }] }), { status: 200 })) as unknown as typeof fetch);
    await expect(withErrors.getManga(1)).rejects.toThrow("Too Many Requests");
  });
});
