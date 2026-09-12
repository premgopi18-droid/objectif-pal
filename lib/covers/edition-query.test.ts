import { describe, expect, it } from "vitest";
import { authorForSearch, validateEditionQuery } from "./edition-query";

describe("validateEditionQuery (#277)", () => {
  it("normalise les espaces et rend l'auteur null quand vide", () => {
    expect(validateEditionQuery({ title: "  La  Horde ", author: "  " })).toEqual({ ok: true, query: { title: "La Horde", author: null } });
  });

  it("refuse un titre vide", () => {
    expect(validateEditionQuery({ title: "   ", author: "Damasio" }).ok).toBe(false);
  });

  it("refuse une requête trop longue, titre ou auteur", () => {
    const long = "x".repeat(201);
    expect(validateEditionQuery({ title: long, author: null }).ok).toBe(false);
    expect(validateEditionQuery({ title: "ok", author: long }).ok).toBe(false);
    expect(validateEditionQuery({ title: "x".repeat(200), author: null }).ok).toBe(true);
  });
});

describe("authorForSearch", () => {
  it("garde le premier nom, sans dates ni rôle BnF", () => {
    expect(authorForSearch("Fléchais, Amélie (1989-....). Auteur du texte")).toBe("Fléchais");
    expect(authorForSearch("Jason Aaron, Chris Bachalo")).toBe("Jason Aaron");
    expect(authorForSearch("Marvel comics. Auteur du texte")).toBe("Marvel comics.");
  });

  it("null quand rien d'exploitable", () => {
    expect(authorForSearch(null)).toBeNull();
    expect(authorForSearch("(1989-....)")).toBeNull();
  });
});
