import { describe, expect, it } from "vitest";
import {
  guessCategoryFromGoogleBooksCategories,
  guessCategoryFromMetronSeriesType,
  guessCategoryFromPublisher,
} from "./guess-category";

describe("la devinette de catégorie (specs §5.5)", () => {
  it.each([
    ["Ki-oon", "manga"],
    ["Éditions Glénat", "manga"],
    ["Kurokawa", "manga"],
    ["Dargaud", "bd"],
    ["Le Lombard", "bd"],
    ["Casterman", "bd"],
    ["Urban Comics", "comics"],
    ["Panini France", "comics"],
  ])("l'éditeur « %s » propose %s", (publisher, category) => {
    expect(guessCategoryFromPublisher(publisher)).toBe(category);
  });

  it("un éditeur inconnu ne propose rien (le signal suivant décidera)", () => {
    expect(guessCategoryFromPublisher("Gallimard")).toBeNull();
    expect(guessCategoryFromPublisher(null)).toBeNull();
  });

  it.each([
    ["Single Issue", "issue"],
    ["One-Shot", "issue"],
    ["Annual", "issue"],
    ["Trade Paperback", "comics"],
    ["Hardcover", "comics"],
    ["Graphic Novel", "comics"],
    ["Omnibus", "omnibus"],
  ])("le series_type Metron « %s » propose %s", (seriesType, category) => {
    expect(guessCategoryFromMetronSeriesType(seriesType)).toBe(category);
  });

  it("les catégories Google Books ne parlent qu'en dernier recours", () => {
    expect(guessCategoryFromGoogleBooksCategories(["Fiction"])).toBe("roman");
    expect(guessCategoryFromGoogleBooksCategories(["Comics & Graphic Novels"])).toBe("comics");
    expect(guessCategoryFromGoogleBooksCategories(["Cooking"])).toBeNull();
    expect(guessCategoryFromGoogleBooksCategories(null)).toBeNull();
  });
});
