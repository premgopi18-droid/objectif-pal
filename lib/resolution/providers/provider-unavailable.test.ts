import { describe, expect, it, vi } from "vitest";
import { ProviderUnavailableError } from "@/lib/resolution/types";
import { createGoogleBooksProvider } from "./google-books";
import { createMetronProvider } from "./metron";

/**
 * Panne ≠ absence (#175) : les deux providers à quota PARTAGÉ (la clé Google
 * Books, le compte Metron) doivent (a) consommer le compteur global AVANT
 * chaque appel HTTP et se taire quand il est épuisé, (b) distinguer un
 * throttle/5xx (source indisponible) d'un « livre absent » (verdict).
 */

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("Google Books et le quota global", () => {
  it("quota épuisé : ProviderUnavailableError, AUCUN appel HTTP", async () => {
    const fetchSpy = vi.fn();
    const provider = createGoogleBooksProvider("cle", fetchSpy as unknown as typeof fetch, async () => false);

    await expect(provider.resolveIsbn("9780804139021")).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("HTTP 429 et 5xx : indisponible (pas un verdict) ; 404 : erreur ordinaire", async () => {
    const at = (status: number) =>
      createGoogleBooksProvider("cle", (async () => jsonResponse({}, status)) as unknown as typeof fetch, async () => true);

    await expect(at(429).resolveIsbn("9780804139021")).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(at(503).resolveIsbn("9780804139021")).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(at(404).resolveIsbn("9780804139021")).rejects.toThrowError(/HTTP 404/);
    await expect(at(404).resolveIsbn("9780804139021")).rejects.not.toBeInstanceOf(ProviderUnavailableError);
  });

  it("sans clé : muet (null), sans consommer le quota", async () => {
    const quota = vi.fn(async () => true);
    const provider = createGoogleBooksProvider(undefined, fetch, quota);

    expect(await provider.resolveIsbn("9780804139021")).toBeNull();
    expect(quota).not.toHaveBeenCalled();
  });
});

describe("Metron et le quota global", () => {
  const credentials = { username: "user", password: "pass" };

  it("quota épuisé : ProviderUnavailableError, AUCUN appel HTTP", async () => {
    const fetchSpy = vi.fn();
    const provider = createMetronProvider(credentials, fetchSpy as unknown as typeof fetch, async () => false);

    await expect(provider.findIssueByUpc("761941341743")).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("chaque appel HTTP consomme un tick : liste puis détail = 2 ticks", async () => {
    const quota = vi.fn(async () => true);
    const fetchImplementation = (async (url: string | URL) =>
      String(url).includes("/issue/?")
        ? jsonResponse({ count: 1, results: [{ id: 7, number: "1" }] })
        : jsonResponse({ id: 7, number: "1", series: { name: "X" } })) as unknown as typeof fetch;
    const provider = createMetronProvider(credentials, fetchImplementation, quota);

    await provider.findIssueByUpc("761941341743");
    expect(quota).toHaveBeenCalledTimes(2);
  });

  it("HTTP 429 : indisponible — le compte partagé ne doit jamais être martelé", async () => {
    const provider = createMetronProvider(
      credentials,
      (async () => jsonResponse({}, 429)) as unknown as typeof fetch,
      async () => true,
    );

    await expect(provider.findIssueByUpc("761941341743")).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});
