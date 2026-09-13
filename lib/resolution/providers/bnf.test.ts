import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createBnfProvider, floorsBySeriesId, parseBnfResponse, parseBnfSearchPage } from "./bnf";

/**
 * Des notices RÉELLES (capturées le 13/09/2026 en `unimarcXchange`), jamais
 * inventées : chaque cas est un ISBN de la base de prod qui illustrait un
 * piège mesuré (lot 0 de l'epic séries, #290).
 */
const fixture = (isbn: string): string =>
  readFileSync(new URL(`./fixtures/bnf/${isbn}.xml`, import.meta.url), "utf8");

const EMPTY_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<srw:searchRetrieveResponse xmlns:srw="http://www.loc.gov/zing/srw/">
  <srw:numberOfRecords>0</srw:numberOfRecords>
</srw:searchRetrieveResponse>`;

describe("le parsing des notices BnF (SRU UNIMARC)", () => {
  it("zone 461 : la série, le tome et l'identifiant de série — le titre DC n'était que l'épisode", () => {
    expect(parseBnfResponse(fixture("9782723494748"))).toEqual({
      title: "Ace entre en scène",
      seriesName: "One piece",
      issueNumber: "18",
      bnfSeriesId: "38888890",
      authors: "Eiichirō Oda", // 700 seulement : le traducteur (702) n'est pas un auteur
      publisher: "Glénat",
      pageCount: 224,
    });
  });

  it("deux éditions d'une même série ont DEUX notices de série chez la BnF (mesuré) — le nom normalisé fera le lien", () => {
    // Deux éditions (2013 « nouvelle édition » vs 2003) → deux notices de
    // série chez la BnF. C'est le nom normalisé qui les rapprochera (lot A) ;
    // le test fige ce que la source donne, pas ce qu'on voudrait.
    const record = parseBnfResponse(fixture("9782723488525"));
    expect(record).toMatchObject({
      title: "Romance dawn : à l'aube d'une grande aventure",
      seriesName: "One piece",
      issueNumber: "1",
      bnfSeriesId: "43702987",
      publisher: "Glénat",
      pageCount: 203,
    });
  });

  it("461 et 200 $h : le numéro vient de la 461, le titre propre reste le titre", () => {
    expect(parseBnfResponse(fixture("9782205203042"))).toEqual({
      title: "Les murailles invisibles",
      seriesName: "Les murailles invisibles",
      issueNumber: "1",
      bnfSeriesId: "47203983",
      authors: "Alex Chauvel",
      publisher: "Dargaud", // 214, la zone moderne, avant 210
      pageCount: 90,
    });
  });

  it("un $t pollué par la mention de responsabilité est coupé au « / »", () => {
    expect(parseBnfResponse(fixture("9791026828822"))).toMatchObject({
      title: "Fables",
      seriesName: "Fables",
      issueNumber: "7", // « [Volume 7] » en 200 $h, « 7 » en 461 $v
      bnfSeriesId: "47197081",
      authors: "Bill Willingham",
      publisher: "Urban comics",
      pageCount: 377,
    });
  });

  it("un numéro en toutes lettres et une pagination approximative sont lus", () => {
    expect(parseBnfResponse(fixture("9791039124614"))).toMatchObject({
      title: "Excalibur. 1990-1991", // le titre de partie ($i) suit le titre propre
      seriesName: "Excalibur",
      issueNumber: "4", // « [Quatrième volume] »
      bnfSeriesId: "46839514",
      authors: "Scott Lobdell, Christopher Claremont", // 700 puis 701
      pageCount: 343, // « non paginé [ca 343] p. »
    });
  });

  it("461 sans $v : la série est connue, le numéro vient du 200 $h", () => {
    expect(parseBnfResponse(fixture("9791039108768"))).toMatchObject({
      title: "Star wars, les récits légendaires. Les vauriens de la galaxie",
      seriesName: "Star wars, légendes",
      issueNumber: "3", // « [3] »
      bnfSeriesId: "47050997",
      authors: null, // ni 700/701 ni 200 $f sur cette notice
      publisher: "Panini comics",
    });
  });

  it("sans 461 ni $h, le titre qui porte son tome est le dernier repli", () => {
    expect(parseBnfResponse(fixture("9782302093744"))).toEqual({
      title: "Abaddon T02 : antinéa",
      seriesName: "Abaddon",
      issueNumber: "2",
      bnfSeriesId: null, // aucune notice de série : le lot A rapprochera par le nom
      authors: "Christophe Bec, Vincent Powell, Jérôme Alvarez", // 700 puis les 701, dans l'ordre de la notice
      publisher: "Soleil",
      pageCount: 56,
    });
  });

  it("un roman en collection n'a PAS de série : le 225 (Le livre de poche, 34028) est ignoré", () => {
    expect(parseBnfResponse(fixture("9782253183969"))).toEqual({
      title: "Joyland : roman",
      seriesName: null,
      issueNumber: null,
      bnfSeriesId: null,
      authors: "Stephen King",
      publisher: "le Livre de poche",
      pageCount: 399,
    });
  });

  it("zéro notice = null (la cascade descend d'un cran)", () => {
    expect(parseBnfResponse(EMPTY_RESPONSE)).toBeNull();
  });

  it("une notice comptée mais sans titre propre (200 $a) vaut null — jamais un livre au titre vide", () => {
    const xml = fixture("9782253183969").replace('<mxc:subfield code="a">Joyland</mxc:subfield>', "");
    expect(parseBnfResponse(xml)).toBeNull();
  });

  it("une anthologie à cinquante auteurs est bornée à six noms + « et al. » (plafond de validateBook)", () => {
    const extraAuthors = Array.from(
      { length: 49 },
      (_, index) =>
        `<mxc:datafield tag="701" ind1=" " ind2="1"><mxc:subfield code="a">Nom${index}</mxc:subfield><mxc:subfield code="b">Prénom${index}</mxc:subfield></mxc:datafield>`,
    ).join("");
    const xml = fixture("9782253183969").replace("</mxc:record>", `${extraAuthors}</mxc:record>`);
    const record = parseBnfResponse(xml);
    expect(record?.authors).toBe("Stephen King, Prénom0 Nom0, Prénom1 Nom1, Prénom2 Nom2, Prénom3 Nom3, Prénom4 Nom4 et al.");
    expect(record?.authors?.length).toBeLessThan(200);
  });

  it("« Fahrenheit 451 » n'est pas le tome 451 de « Fahrenheit »", () => {
    const xml = fixture("9782253183969").replace(
      '<mxc:subfield code="a">Joyland</mxc:subfield>',
      '<mxc:subfield code="a">Fahrenheit 451</mxc:subfield>',
    );
    expect(parseBnfResponse(xml)).toMatchObject({ title: "Fahrenheit 451 : roman", seriesName: null, issueNumber: null });
  });
});

describe("le provider BnF", () => {
  it("interroge le SRU en UNIMARC avec l'identité de l'app", async () => {
    const fetchImplementation = vi.fn(async () => new Response(fixture("9782723494748"), { status: 200 }));
    const provider = createBnfProvider(fetchImplementation as unknown as typeof fetch);

    const record = await provider.resolveIsbn("9782723494748");

    expect(record?.seriesName).toBe("One piece");
    const [url, init] = fetchImplementation.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("recordSchema=unimarcXchange");
    expect(url).toContain(encodeURIComponent('bib.isbn any "9782723494748"'));
    expect((init.headers as Record<string, string>)["User-Agent"]).toContain("objectif-pal");
  });

  it("une réponse HTTP en erreur jette (panne ≠ absence)", async () => {
    const provider = createBnfProvider((async () => new Response("", { status: 503 })) as unknown as typeof fetch);
    await expect(provider.resolveIsbn("9782723494748")).rejects.toThrow("HTTP 503");
  });
});

describe("le plancher VF par édition (#299) — une page de recherche réelle (Death Note / Ohba, élaguée)", () => {
  const page = () => readFileSync(new URL("./fixtures/bnf/search-death-note.xml", import.meta.url), "utf8");

  it("ne garde que les notices rattachées à une notice de série, avec leur tome et leur éditeur", () => {
    const parsed = parseBnfSearchPage(page());
    expect(parsed.numberOfRecords).toBe(36);
    // 36 notices dont 20 rattachées à une série (les autres : guides, artbooks, romans).
    expect(parsed.volumes).toHaveLength(20);
    expect(parsed.volumes.filter((volume) => volume.seriesId === "41000718").map((volume) => volume.publisher)).toContain("Kana");
  });

  it("le plancher est le PLUS GRAND tome déposé — pas le compte, bruité par les rééditions", () => {
    const floors = floorsBySeriesId(parseBnfSearchPage(page()).volumes, ["41000718", "42249221", "42152423"]);
    expect(floors.get("41000718")).toEqual({ knownMax: 13, label: "Kana", noticeCount: 13 });
    expect(floors.get("42249221")).toEqual({ knownMax: 3, label: "Kana", noticeCount: 3 });
    // France loisirs : deux notices sans numéro exploitable → pas de plancher.
    expect(floors.has("42152423")).toBe(false);
  });

  it("une édition non demandée n'entre pas (une édition non possédée n'est pas une série de l'utilisateur)", () => {
    const floors = floorsBySeriesId(parseBnfSearchPage(page()).volumes, ["41000718"]);
    expect([...floors.keys()]).toEqual(["41000718"]);
  });

  it("le provider pagine jusqu'à la dernière page et s'arrête au plafond", async () => {
    // Une page réelle rejouée avec un total gonflé : 250 notices → 3 pages ; plafond à 2.
    const inflated = page().replace("<srw:numberOfRecords>36<", "<srw:numberOfRecords>250<");
    const fetchImplementation = vi.fn(async () => new Response(inflated, { status: 200 }));
    const provider = createBnfProvider(fetchImplementation as unknown as typeof fetch);

    const floors = await provider.searchSeriesFloors({ title: "Death note", author: "Ohba", seriesIds: ["41000718"], maxPages: 2, timeoutMs: 1000 });

    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    const urls = fetchImplementation.mock.calls.map((call) => String((call as unknown[])[0]));
    expect(urls[0]).toContain("startRecord=1");
    expect(urls[1]).toContain("startRecord=101");
    expect(urls[0]).toContain(encodeURIComponent('bib.title all "Death note" and bib.author all "Ohba"'));
    expect(floors.get("41000718")?.knownMax).toBe(13);
  });

  it("sans auteur, la requête n'a que le titre ; les guillemets d'un titre sont neutralisés", async () => {
    const fetchImplementation = vi.fn(async () => new Response(page(), { status: 200 }));
    const provider = createBnfProvider(fetchImplementation as unknown as typeof fetch);
    await provider.searchSeriesFloors({ title: 'Death "note"', author: null, seriesIds: [], maxPages: 1, timeoutMs: 1000 });
    const url = String((fetchImplementation.mock.calls[0] as unknown[])[0]);
    expect(url).toContain(encodeURIComponent('bib.title all "Death note"'));
    expect(url).not.toContain("bib.author");
  });
});
