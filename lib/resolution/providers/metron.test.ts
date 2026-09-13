import { describe, expect, it, vi } from "vitest";
import { createMetronProvider } from "./metron";

/**
 * Les variantes Metron (#276, mesuré le 12/09/2026 sur Absolute Green Arrow) :
 * le filtre de liste `?upc=` ne matche que la cover A, mais le détail porte
 * `variants[]` avec nom, UPC et image. Le code scanné choisit la variante — et
 * ça ne coûte aucun appel de plus, le détail est déjà chargé.
 */

const credentials = { username: "user", password: "pass" };
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const MAIN_UPC = "76194139422000411";
const COVER_B_UPC = "76194139422000421";
const COVER_H_UPC = "76194139422000481";

/** Un Metron factice : la liste ne connaît que l'UPC principal, le détail a les variantes. */
function fakeMetron() {
  const calls: string[] = [];
  const fetchImplementation = (async (url: string | URL) => {
    const path = String(url);
    calls.push(path);
    if (path.includes("/issue/?upc=")) {
      const upc = path.split("upc=")[1];
      return upc === MAIN_UPC
        ? jsonResponse({ count: 1, results: [{ id: 173173, issue: "Absolute Green Arrow (2026) #4", number: "4", image: "https://static.metron.cloud/main.jpg" }] })
        : jsonResponse({ count: 0, results: [] });
    }
    if (path.includes("/issue/?gcd_id=")) {
      return jsonResponse({ count: 1, results: [{ id: 173173, number: "4", image: "https://static.metron.cloud/main.jpg" }] });
    }
    return jsonResponse({
      id: 173173,
      number: "4",
      image: "https://static.metron.cloud/main.jpg",
      series: { name: "Absolute Green Arrow", series_type: { name: "Single Issue" } },
      variants: [
        { name: "Cover B Martin Simmonds Variant", upc: COVER_B_UPC, image: "https://static.metron.cloud/b.jpg" },
        { name: "Cover C Kris Anka Variant", upc: "76194139422000431", image: "https://static.metron.cloud/c.jpg" },
        { name: "616 Comics Björn Barends Variant", upc: "", image: "https://static.metron.cloud/616.jpg" },
        { name: "Sans image", upc: "76194139422000451", image: null },
      ],
    });
  }) as unknown as typeof fetch;
  return { provider: createMetronProvider(credentials, fetchImplementation, async () => true), calls };
}

describe("les variantes Metron (#276)", () => {
  it("la variante dont l'UPC égale le code scanné donne SA couverture, pas la principale", async () => {
    const { provider, calls } = fakeMetron();
    const issue = await provider.findIssueByUpc(COVER_B_UPC);

    expect(issue?.coverUrl).toBe("https://static.metron.cloud/b.jpg");
    expect(issue?.mainCoverUrl).toBe("https://static.metron.cloud/main.jpg");
    expect(issue?.matchedVariantUpc).toBe(COVER_B_UPC);
    // Liste (exact, vide) + liste (normalisé) + détail : rien de plus qu'avant.
    expect(calls.filter((path) => path.includes("/issue/?upc=")).length).toBe(2);
    expect(calls.filter((path) => /\/issue\/\d+\/$/.test(path)).length).toBe(1);
  });

  it("un code sans variante correspondante (cover H inconnue) : couverture principale, sans match", async () => {
    const { provider } = fakeMetron();
    const issue = await provider.findIssueByUpc(COVER_H_UPC);

    expect(issue?.coverUrl).toBe("https://static.metron.cloud/main.jpg");
    expect(issue?.matchedVariantUpc).toBeNull();
  });

  it("les variantes sans image sont ignorées, celles sans UPC gardées (exclusivités boutique)", async () => {
    const { provider } = fakeMetron();
    const issue = await provider.findIssueByUpc(MAIN_UPC);

    expect(issue?.variants.map((variant) => variant.name)).toEqual([
      "Cover B Martin Simmonds Variant",
      "Cover C Kris Anka Variant",
      "616 Comics Björn Barends Variant",
    ]);
    expect(issue?.variants[2].upc).toBeNull();
  });

  it("par gcd_id, le code scanné choisit aussi la variante", async () => {
    const { provider } = fakeMetron();
    const issue = await provider.findIssueByGcdId(2844040, COVER_B_UPC);
    expect(issue?.coverUrl).toBe("https://static.metron.cloud/b.jpg");
    const plain = await provider.findIssueByGcdId(2844040);
    expect(plain?.coverUrl).toBe("https://static.metron.cloud/main.jpg");
  });

  it("le nom d'une variante vide devient « Variante »", async () => {
    const fetchImplementation = (async (url: string | URL) =>
      String(url).includes("/issue/?")
        ? jsonResponse({ count: 1, results: [{ id: 1, number: "1" }] })
        : jsonResponse({ id: 1, number: "1", variants: [{ name: "  ", upc: null, image: "https://static.metron.cloud/x.jpg" }] })) as unknown as typeof fetch;
    const provider = createMetronProvider(credentials, fetchImplementation, vi.fn(async () => true));
    const issue = await provider.findIssueByUpc(MAIN_UPC);
    expect(issue?.variants).toEqual([{ name: "Variante", upc: null, coverUrl: "https://static.metron.cloud/x.jpg" }]);
  });
});

describe("findIssueById — un tick au lieu de trois (audit #274)", () => {
  it("lit le détail directement, la variante scannée choisie, sans appel de liste", async () => {
    const { provider, calls } = fakeMetron();
    const issue = await provider.findIssueById(173173, COVER_B_UPC);
    expect(issue?.coverUrl).toBe("https://static.metron.cloud/b.jpg");
    expect(issue?.issueName).toBe("Absolute Green Arrow #4");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/\/issue\/173173\/$/);
  });

  it("un identifiant invalide ne coûte rien ; un 404 est une absence, pas une panne", async () => {
    const { provider, calls } = fakeMetron();
    expect(await provider.findIssueById(0)).toBeNull();
    expect(await provider.findIssueById(1.5)).toBeNull();
    expect(calls).toHaveLength(0);
    const gone = createMetronProvider(credentials, (async () => jsonResponse({}, 404)) as unknown as typeof fetch, async () => true);
    expect(await gone.findIssueById(42)).toBeNull();
  });

  it("le code scanné est encodé dans la requête de liste (audit #274)", async () => {
    const { provider, calls } = fakeMetron();
    await provider.findIssueByUpc("123&page_size=1000");
    expect(calls[0]).toContain("upc=123%26page_size%3D1000");
  });
});
