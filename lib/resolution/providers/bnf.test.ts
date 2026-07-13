import { describe, expect, it } from "vitest";
import { parseBnfResponse } from "./bnf";

/** Fixture réduite d'une vraie réponse SRU (Père & fils, tome 4, Ki-oon). */
const REAL_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<srw:searchRetrieveResponse xmlns:srw="http://www.loc.gov/zing/srw/">
  <srw:version>1.2</srw:version>
  <srw:numberOfRecords>1</srw:numberOfRecords>
  <srw:records>
    <srw:record>
      <srw:recordData>
        <oai_dc:dc xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/" xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:title>Père &amp; fils. 4 / Mi Tagawa</dc:title>
          <dc:creator>Tagawa, Mi (1982-....). Auteur du texte</dc:creator>
          <dc:publisher>Ki-oon</dc:publisher>
          <dc:date>2016</dc:date>
          <dc:format>1 vol. (206 p.) : ill. ; 18 cm</dc:format>
        </oai_dc:dc>
      </srw:recordData>
    </srw:record>
  </srw:records>
</srw:searchRetrieveResponse>`;

const EMPTY_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<srw:searchRetrieveResponse xmlns:srw="http://www.loc.gov/zing/srw/">
  <srw:numberOfRecords>0</srw:numberOfRecords>
</srw:searchRetrieveResponse>`;

describe("le parsing des réponses BnF (SRU Dublin Core)", () => {
  it("extrait titre, tome, auteur, éditeur et pages d'une notice réelle", () => {
    expect(parseBnfResponse(REAL_RESPONSE)).toEqual({
      title: "Père & fils. 4",
      seriesName: "Père & fils",
      issueNumber: "4",
      authors: "Tagawa, Mi (1982-....). Auteur du texte",
      publisher: "Ki-oon",
      pageCount: 206,
    });
  });

  it("zéro notice = null (la cascade descend d'un cran)", () => {
    expect(parseBnfResponse(EMPTY_RESPONSE)).toBeNull();
  });

  it("un titre sans tome reste entier, sans série déduite", () => {
    const xml = REAL_RESPONSE.replace("Père &amp; fils. 4 / Mi Tagawa", "L'Étranger / Albert Camus");
    const record = parseBnfResponse(xml);
    expect(record?.title).toBe("L'Étranger");
    expect(record?.seriesName).toBeNull();
    expect(record?.issueNumber).toBeNull();
  });
});
