import { describe, expect, it, vi } from "vitest";
import { createBnfCoversProvider } from "./bnf-covers";

/** Une réponse factice au niveau de détail que le provider consomme. */
function fakeResponse(overrides: { status?: number; contentType?: string | null } = {}) {
  const { status = 200, contentType = "image/jpeg" } = overrides;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(contentType ? { "content-type": contentType } : {}),
    body: { cancel: vi.fn(async () => {}) },
  } as unknown as Response;
}

describe("le provider BnF Couvertures", () => {
  it("rend l'URL interrogée quand la BnF répond une image", async () => {
    const fetchMock = vi.fn(async () => fakeResponse());
    const provider = createBnfCoversProvider(fetchMock as unknown as typeof fetch);

    const url = await provider.findCoverByIsbn("9782226250223");

    expect(url).toBe(
      "https://openapi.bnf.fr/couverture/image/image/recupererImage?ISBN=9782226250223&couverture=1&taille=originale",
    );
  });

  it("HTTP 500 = image absente (comportement mesuré, PAS une panne) : null sans jeter", async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ status: 500, contentType: "text/html" }));
    const provider = createBnfCoversProvider(fetchMock as unknown as typeof fetch);

    await expect(provider.findCoverByIsbn("9791026820963")).resolves.toBeNull();
  });

  it("un 200 qui n'est pas une image (page d'erreur bêta) ne passe pas pour une couverture", async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ contentType: "application/json" }));
    const provider = createBnfCoversProvider(fetchMock as unknown as typeof fetch);

    await expect(provider.findCoverByIsbn("9782226250223")).resolves.toBeNull();
  });

  it("relâche le corps de la réponse : on ne télécharge jamais l'image", async () => {
    const response = fakeResponse();
    const fetchMock = vi.fn(async () => response);
    const provider = createBnfCoversProvider(fetchMock as unknown as typeof fetch);

    await provider.findCoverByIsbn("9782226250223");

    expect((response.body as unknown as { cancel: ReturnType<typeof vi.fn> }).cancel).toHaveBeenCalled();
  });
});
