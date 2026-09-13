import { describe, expect, it, vi } from "vitest";
import { ProviderUnavailableError } from "@/lib/resolution/types";
import { createComicVineProvider } from "./comic-vine";

/**
 * Comic Vine (#279) : muet sans clé, volume choisi par nom puis année la plus
 * proche, principale + variantes légendées, panne ≠ absence, et la clé ne
 * fuit jamais dans une erreur.
 */

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function fakeComicVine() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImplementation = (async (url: string | URL, init?: RequestInit) => {
    const path = String(url);
    calls.push({ url: path, init });
    if (path.includes("/api/search/")) {
      return jsonResponse({
        status_code: 1,
        results: [
          { id: 1, name: "Nightwing", start_year: "1996" },
          { id: 2, name: "Nightwing", start_year: "2016" },
          { id: 3, name: "Nightwing: The New Order", start_year: "2017" },
          { name: "Sans id" },
        ],
      });
    }
    if (path.includes("/api/issues/")) {
      return jsonResponse({
        status_code: 1,
        results: [
          {
            id: 99,
            site_detail_url: "https://comicvine.gamespot.com/nightwing-123/4000-99/",
            image: { original_url: "https://comicvine.gamespot.com/a/uploads/original/main.jpg" },
            associated_images: [
              { original_url: "https://comicvine.gamespot.com/a/uploads/original/b.jpg", caption: "Variant cover by Simmonds" },
              { original_url: "https://comicvine.gamespot.com/a/uploads/original/main.jpg", caption: "doublon" },
              { original_url: "https://comicvine.gamespot.com/a/uploads/original/c.jpg", caption: "  " },
            ],
          },
        ],
      });
    }
    return jsonResponse({}, 404);
  }) as unknown as typeof fetch;
  return { provider: createComicVineProvider("secret-key", fetchImplementation, async () => true), calls };
}

describe("Comic Vine (#279)", () => {
  it("sans clé : [], ni quota ni fetch — et isEnabled dit false", async () => {
    const fetchSpy = vi.fn();
    const quota = vi.fn(async () => true);
    const provider = createComicVineProvider(undefined, fetchSpy as unknown as typeof fetch, quota);
    expect(provider.isEnabled()).toBe(false);
    expect(await provider.findIssueCovers({ seriesName: "Nightwing", issueNumber: "123", startYear: 2016 })).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(quota).not.toHaveBeenCalled();
  });

  it("volume choisi par nom normalisé puis année la plus proche ; principale + variantes légendées, dédoublonnées", async () => {
    const { provider, calls } = fakeComicVine();
    const covers = await provider.findIssueCovers({ seriesName: "nightwing", issueNumber: "123", startYear: 2015 });

    expect(calls[1].url).toContain("filter=volume%3A2%2Cissue_number%3A123");
    expect(covers).toEqual([
      { url: "https://comicvine.gamespot.com/a/uploads/original/main.jpg", caption: null, comicVineUrl: "https://comicvine.gamespot.com/nightwing-123/4000-99/" },
      { url: "https://comicvine.gamespot.com/a/uploads/original/b.jpg", caption: "Variant cover by Simmonds", comicVineUrl: "https://comicvine.gamespot.com/nightwing-123/4000-99/" },
      { url: "https://comicvine.gamespot.com/a/uploads/original/c.jpg", caption: null, comicVineUrl: "https://comicvine.gamespot.com/nightwing-123/4000-99/" },
    ]);
  });

  it("sans année connue : le premier volume au bon nom ; aucun nom qui matche : []", async () => {
    const { provider, calls } = fakeComicVine();
    await provider.findIssueCovers({ seriesName: "Nightwing", issueNumber: "1", startYear: null });
    expect(calls[1].url).toContain("volume%3A1%2C");
    expect(await provider.findIssueCovers({ seriesName: "Batman", issueNumber: "1", startYear: null })).toEqual([]);
  });

  it("l'UA identifiant est envoyé, la clé voyage en query", async () => {
    const { provider, calls } = fakeComicVine();
    await provider.findIssueCovers({ seriesName: "Nightwing", issueNumber: "123", startYear: null });
    expect(calls[0].init).toMatchObject({ headers: { "User-Agent": expect.stringContaining("objectif-pal") } });
    expect(calls[0].url).toContain("api_key=secret-key");
    expect(calls[0].url).toContain("format=json");
  });

  it("403, 420, 429, 5xx et status_code d'erreur → ProviderUnavailableError, sans la clé dans le message", async () => {
    for (const status of [403, 420, 429, 503]) {
      const provider = createComicVineProvider("secret-key", (async () => jsonResponse({}, status)) as unknown as typeof fetch, async () => true);
      await expect(provider.findIssueCovers({ seriesName: "X", issueNumber: "1", startYear: null })).rejects.toBeInstanceOf(ProviderUnavailableError);
    }
    const invalidKey = createComicVineProvider("secret-key", (async () => jsonResponse({ status_code: 100, error: "Invalid API Key" })) as unknown as typeof fetch, async () => true);
    const error = await invalidKey.findIssueCovers({ seriesName: "X", issueNumber: "1", startYear: null }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect(String((error as Error).message)).not.toContain("secret-key");
  });

  it("quota refusé : ProviderUnavailableError, aucun fetch", async () => {
    const fetchSpy = vi.fn();
    const provider = createComicVineProvider("secret-key", fetchSpy as unknown as typeof fetch, async () => false);
    await expect(provider.findIssueCovers({ seriesName: "X", issueNumber: "1", startYear: null })).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
