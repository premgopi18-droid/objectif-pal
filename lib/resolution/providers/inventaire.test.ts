import { describe, expect, it, vi } from "vitest";
import { createInventaireProvider, resizedInventaireVariant } from "./inventaire";

const BARE_URL = "https://inventaire.io/img/entities/9575f8392fe7afb21427a4bd9c388704e2c23b9d";
const RESIZED_URL = "https://inventaire.io/img/entities/400x400/9575f8392fe7afb21427a4bd9c388704e2c23b9d";

/** La réponse de l'API by-uris, au niveau de détail que le provider consomme. */
function apiResponse(imagePath: string | null) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      entities: { "isbn:9782365772013": imagePath ? { image: { url: imagePath } } : {} },
    }),
  } as unknown as Response;
}

/** Une réponse HEAD d'image : `contentLength` null = en-tête absent. */
function headResponse(overrides: { status?: number; contentLength?: string | null } = {}) {
  const { status = 200, contentLength = "42880" } = overrides;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(contentLength === null ? {} : { "content-length": contentLength }),
  } as unknown as Response;
}

/** Un fetch factice routé par URL : l'API d'abord, puis les HEAD d'images. */
function fakeFetch(imagePath: string | null, headByUrl: Record<string, Response | Error>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/entities/by-uris")) return apiResponse(imagePath);
    const head = headByUrl[url];
    if (!head) throw new Error(`HEAD inattendu : ${url}`);
    if (head instanceof Error) throw head;
    return head;
  });
}

describe("le provider Inventaire", () => {
  it("préfère la variante redimensionnée quand elle est vivante (cache pleine taille empoisonné, 12/09/2026)", async () => {
    const fetchMock = fakeFetch("/img/entities/9575f8392fe7afb21427a4bd9c388704e2c23b9d", {
      [RESIZED_URL]: headResponse(),
    });
    const provider = createInventaireProvider(fetchMock as unknown as typeof fetch);

    await expect(provider.findCoverByIsbn("9782365772013")).resolves.toBe(RESIZED_URL);
    // La variante a suffi : l'URL nue n'est jamais sondée.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("variante vide (200 de 0 octet) : repli sur l'URL nue si elle est vivante", async () => {
    const fetchMock = fakeFetch("/img/entities/9575f8392fe7afb21427a4bd9c388704e2c23b9d", {
      [RESIZED_URL]: headResponse({ contentLength: "0" }),
      [BARE_URL]: headResponse(),
    });
    const provider = createInventaireProvider(fetchMock as unknown as typeof fetch);

    await expect(provider.findCoverByIsbn("9782365772013")).resolves.toBe(BARE_URL);
  });

  it("variante ET URL nue vides : null — le cran suivant de la cascade joue (#158)", async () => {
    const fetchMock = fakeFetch("/img/entities/9575f8392fe7afb21427a4bd9c388704e2c23b9d", {
      [RESIZED_URL]: headResponse({ contentLength: "0" }),
      [BARE_URL]: headResponse({ contentLength: "0" }),
    });
    const provider = createInventaireProvider(fetchMock as unknown as typeof fetch);

    await expect(provider.findCoverByIsbn("9782365772013")).resolves.toBeNull();
  });

  it("HEAD de la variante qui jette (réseau) : le repli joue quand même", async () => {
    const fetchMock = fakeFetch("/img/entities/9575f8392fe7afb21427a4bd9c388704e2c23b9d", {
      [RESIZED_URL]: new Error("réseau"),
      [BARE_URL]: headResponse(),
    });
    const provider = createInventaireProvider(fetchMock as unknown as typeof fetch);

    await expect(provider.findCoverByIsbn("9782365772013")).resolves.toBe(BARE_URL);
  });

  it("entité sans image : null sans sonder quoi que ce soit", async () => {
    const fetchMock = fakeFetch(null, {});
    const provider = createInventaireProvider(fetchMock as unknown as typeof fetch);

    await expect(provider.findCoverByIsbn("9782365772013")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("HTTP 400 de l'API (ISBN jugé invalide) : « introuvable », pas une panne", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 400 }) as unknown as Response);
    const provider = createInventaireProvider(fetchMock as unknown as typeof fetch);

    await expect(provider.findCoverByIsbn("9782365772013")).resolves.toBeNull();
  });
});

describe("resizedInventaireVariant", () => {
  it("réécrit l'URL nue d'une entité vers la variante 400x400", () => {
    expect(resizedInventaireVariant(BARE_URL)).toBe(RESIZED_URL);
  });

  it("laisse passer ce qui n'a pas la forme nue : autre hôte, déjà redimensionnée, chemin étranger", () => {
    expect(resizedInventaireVariant("https://covers.openlibrary.org/b/id/1234-L.jpg")).toBeNull();
    expect(resizedInventaireVariant(RESIZED_URL)).toBeNull();
    expect(resizedInventaireVariant("https://inventaire.io/api/entities/by-uris")).toBeNull();
    expect(resizedInventaireVariant("pas-une-url")).toBeNull();
  });
});
