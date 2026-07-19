import { describe, expect, it, vi } from "vitest";
import { createEpagineProvider } from "./epagine";

/** Une réponse factice au niveau de détail que le provider consomme. */
function fakeResponse(overrides: { status?: number; contentType?: string } = {}) {
  const { status = 200, contentType = "image/jpeg" } = overrides;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": contentType }),
  } as unknown as Response;
}

describe("le provider epagine", () => {
  it("construit l'URL mesurée (dossier = 3 derniers chiffres) et vérifie en HEAD", async () => {
    const fetchMock = vi.fn(async () => fakeResponse());
    const provider = createEpagineProvider(fetchMock as unknown as typeof fetch);

    const url = await provider.findCoverByIsbn("9791026820963");

    expect(url).toBe("https://images.epagine.fr/963/9791026820963_1_75.jpg");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://images.epagine.fr/963/9791026820963_1_75.jpg",
      expect.objectContaining({ method: "HEAD" }),
    );
  });

  it("le placeholder PNG en 200 = ISBN inconnu (comportement mesuré) : null", async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ contentType: "image/png" }));
    const provider = createEpagineProvider(fetchMock as unknown as typeof fetch);

    await expect(provider.findCoverByIsbn("9782000000006")).resolves.toBeNull();
  });

  it("404 = introuvable (null), autre erreur = panne (jette, la cascade amortit)", async () => {
    const notFound = createEpagineProvider(vi.fn(async () => fakeResponse({ status: 404 })) as unknown as typeof fetch);
    await expect(notFound.findCoverByIsbn("9782000000006")).resolves.toBeNull();

    const outage = createEpagineProvider(vi.fn(async () => fakeResponse({ status: 503 })) as unknown as typeof fetch);
    await expect(outage.findCoverByIsbn("9782000000006")).rejects.toThrow("epagine : HTTP 503");
  });
});
