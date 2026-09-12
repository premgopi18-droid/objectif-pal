import { describe, expect, it, vi } from "vitest";
import { ProviderUnavailableError } from "@/lib/resolution/types";
import { createOpenLibraryProvider } from "./open-library";

/**
 * OpenLibrary : la couverture par ISBN (cran de la cascade, §5.4) et, depuis
 * #277, les éditions sœurs d'une œuvre par titre + auteur — formes d'API
 * relevées le 12/09/2026 (`search.json`, `/works/{id}/editions.json`).
 */

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Un OpenLibrary factice : une recherche, deux œuvres, leurs éditions. */
function fakeOpenLibrary() {
  const calls: string[] = [];
  const fetchImplementation = (async (url: string | URL, init?: RequestInit) => {
    const path = String(url);
    calls.push(path);
    if (init?.method === "HEAD") return new Response(null, { status: path.includes("9782070342266") ? 200 : 404 });
    if (path.includes("/search.json")) {
      return jsonResponse({
        docs: [
          { key: "/works/OL1W", title: "La Horde du Contrevent", cover_i: 6670450, edition_count: 3 },
          { key: "/works/OL2W", title: "La horde du contrevent", cover_i: 999, edition_count: 1 },
          { title: "Sans clé" },
        ],
      });
    }
    if (path.includes("/works/OL1W/editions.json")) {
      return jsonResponse({
        entries: [
          { covers: [15250589, 12366204], publishers: ["GALLIMARD", "FOLIO"], publish_date: "Feb 04, 2021", isbn_13: ["9782072927515"] },
          { covers: [-1], publishers: ["Sans image"], publish_date: "2019" },
          { covers: [6670450], publishers: ["Gallimard"], publish_date: "22/12/2007", isbn_13: ["9782070342266"] },
          { covers: [7891413], publishers: ["Gallimard"], publish_date: "2015" },
        ],
      });
    }
    if (path.includes("/works/OL2W/editions.json")) {
      // Aucune édition avec image : la couverture de l'œuvre ferme la liste.
      return jsonResponse({ entries: [{ publishers: ["X"] }] });
    }
    return jsonResponse({}, 404);
  }) as unknown as typeof fetch;
  return { provider: createOpenLibraryProvider(fetchImplementation), calls };
}

describe("findCoverByIsbn", () => {
  it("200 → l'URL SANS default=false ; 404 → null", async () => {
    const { provider, calls } = fakeOpenLibrary();
    expect(await provider.findCoverByIsbn("9782070342266")).toBe("https://covers.openlibrary.org/b/isbn/9782070342266-L.jpg");
    expect(calls[0]).toContain("?default=false");
    expect(await provider.findCoverByIsbn("9780000000000")).toBeNull();
  });
});

describe("searchEditionCovers (#277)", () => {
  it("une œuvre → ses éditions avec image, année décroissante, sans les éditions sans covers", async () => {
    const { provider } = fakeOpenLibrary();
    const editions = await provider.searchEditionCovers({ title: "La Horde du Contrevent", author: "Damasio" }, { works: 1 });

    expect(editions.map((edition) => [edition.year, edition.publisher])).toEqual([
      ["2021", "GALLIMARD"],
      ["2015", "Gallimard"],
      ["2007", "Gallimard"],
    ]);
    expect(editions[0].coverUrl).toBe("https://covers.openlibrary.org/b/id/15250589-L.jpg");
    expect(editions[0].isbn13).toBe("9782072927515");
    expect(editions[0].workTitle).toBe("La Horde du Contrevent");
  });

  it("la couverture de l'œuvre ferme la liste quand aucune édition ne la portait ; dédoublonnage par image", async () => {
    const { provider } = fakeOpenLibrary();
    const editions = await provider.searchEditionCovers({ title: "La Horde du Contrevent", author: null });
    const urls = editions.map((edition) => edition.coverUrl);
    // 6670450 est déjà porté par l'édition 2007 de l'œuvre 1 : pas de doublon.
    expect(urls.filter((url) => url.includes("6670450")).length).toBe(1);
    // L'œuvre 2 n'a aucune édition avec image : sa cover_i 999 est proposée, sans éditeur ni année.
    expect(editions.at(-1)).toEqual({ coverUrl: "https://covers.openlibrary.org/b/id/999-L.jpg", workTitle: "La horde du contrevent", publisher: null, year: null, isbn13: null });
  });

  it("la requête est encodée et l'auteur omis quand absent ; les œuvres sont lues en parallèle", async () => {
    const { provider, calls } = fakeOpenLibrary();
    await provider.searchEditionCovers({ title: "L'abîme & co", author: null });
    expect(calls[0]).toContain("title=L%27ab%C3%AEme+%26+co");
    expect(calls[0]).not.toContain("author=");
    expect(calls.filter((path) => path.includes("/editions.json")).length).toBe(2);
    await provider.searchEditionCovers({ title: "x", author: "Damasio" });
    expect(calls.find((path) => path.includes("title=x"))).toContain("author=Damasio");
  });

  it("429 → ProviderUnavailableError ; 404 → erreur ordinaire ; aucun résultat → []", async () => {
    const down = createOpenLibraryProvider((async () => jsonResponse({}, 429)) as unknown as typeof fetch);
    await expect(down.searchEditionCovers({ title: "x", author: null })).rejects.toBeInstanceOf(ProviderUnavailableError);
    const missing = createOpenLibraryProvider((async () => jsonResponse({}, 404)) as unknown as typeof fetch);
    await expect(missing.searchEditionCovers({ title: "x", author: null })).rejects.toThrow("HTTP 404");
    const empty = createOpenLibraryProvider((async () => jsonResponse({ docs: [] })) as unknown as typeof fetch);
    expect(await empty.searchEditionCovers({ title: "x", author: null })).toEqual([]);
  });

  it("l'UA identifiant est envoyé (#193)", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ docs: [] }));
    await createOpenLibraryProvider(fetchSpy as unknown as typeof fetch).searchEditionCovers({ title: "x", author: null });
    expect((fetchSpy.mock.calls[0] as unknown[])[1]).toMatchObject({ headers: { "User-Agent": expect.stringContaining("objectif-pal") } });
  });
});
