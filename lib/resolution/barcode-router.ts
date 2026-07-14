/**
 * Le routage d'un code scanné — specs §5.1 : les premiers chiffres du code
 * disent eux-mêmes ce que c'est, il n'y a qu'un seul point d'entrée.
 *
 * Le piège du supplément de 5 chiffres (§5.1) :
 *   - sur un fascicule (UPC-A)   → numéro d'issue + couverture + tirage : ON LE GARDE ;
 *   - sur un livre (EAN-13 978…) → le prix : ON LE JETTE.
 */

/** EAN-13 d'un livre : préfixe « Bookland ». */
const BOOKLAND_PREFIXES = /^97[89]/;

/** Longueurs : UPC-A nu, et UPC-A + supplément de 5. */
const UPC_BASE_LENGTH = 12;
const UPC_WITH_SUPPLEMENT_LENGTH = 17;
const EAN13_LENGTH = 13;
const MINIMUM_BARCODE_LENGTH = 8;

export type ScannedCode =
  | {
      type: "isbn";
      /** Les chiffres tels que scannés (supplément prix inclus s'il y était). */
      raw: string;
      /** L'EAN-13 seul — le prix est jeté. */
      ean13: string;
      /** Les formes sous lesquelles chercher : EAN-13, et ISBN-10 si convertible. */
      isbnCandidates: string[];
    }
  | {
      type: "upc";
      raw: string;
      /** Les 12 premiers chiffres — identifient le TITRE (la série). */
      base: string;
      /** Les 5 chiffres du supplément (numéro + couverture + tirage), si scannés. */
      supplement: string | null;
    }
  | { type: "invalid"; raw: string };

/** Classe un code scanné : ISBN (livre) ou UPC (fascicule VO). */
export function classifyScannedCode(input: string): ScannedCode {
  const digits = input.replace(/\D/g, "");

  if (digits.length < MINIMUM_BARCODE_LENGTH) {
    return { type: "invalid", raw: digits };
  }

  if (BOOKLAND_PREFIXES.test(digits) && digits.length >= EAN13_LENGTH) {
    const ean13 = digits.slice(0, EAN13_LENGTH);
    const isbn10 = isbn13ToIsbn10(ean13);
    // GCD stocke indifféremment des ISBN-10 et des ISBN-13 — et la casse du X
    // final dépend du dump : on cherche toutes les formes (match exact en base).
    const isbnCandidates = [ean13];
    if (isbn10) {
      isbnCandidates.push(isbn10);
      if (isbn10.endsWith("X")) isbnCandidates.push(isbn10.slice(0, -1) + "x");
    }
    return { type: "isbn", raw: digits, ean13, isbnCandidates };
  }

  return {
    type: "upc",
    raw: digits,
    base: digits.slice(0, UPC_BASE_LENGTH),
    supplement: digits.length >= UPC_WITH_SUPPLEMENT_LENGTH ? digits.slice(UPC_BASE_LENGTH, UPC_WITH_SUPPLEMENT_LENGTH) : null,
  };
}

/**
 * ISBN-13 → ISBN-10. Seuls les `978…` ont un équivalent (les `979…` n'en ont
 * jamais eu) : on retire le préfixe et on recalcule la clé.
 */
export function isbn13ToIsbn10(ean13: string): string | null {
  if (!ean13.startsWith("978") || ean13.length !== EAN13_LENGTH) return null;
  const core = ean13.slice(3, 12);
  let checksum = 0;
  for (let index = 0; index < 9; index += 1) {
    checksum += Number(core[index]) * (10 - index);
  }
  const remainder = (11 - (checksum % 11)) % 11;
  return core + (remainder === 10 ? "X" : String(remainder));
}

/**
 * Normalise un UPC complet pour Metron — découverte mesurée (specs §5.4) :
 * Metron ne référence que la couverture PRINCIPALE d'une issue. Le supplément
 * encode la couverture en 4ᵉ position (`…123`**`2`**`1` = cover B) : on la
 * remet à `1` pour retrouver l'issue, quelle que soit la variante scannée.
 */
export function normalizeUpcForMetron(code: string): string | null {
  if (code.length < UPC_WITH_SUPPLEMENT_LENGTH) return null;
  const base = code.slice(0, UPC_BASE_LENGTH);
  const supplement = code.slice(UPC_BASE_LENGTH, UPC_WITH_SUPPLEMENT_LENGTH);
  return base + supplement.slice(0, 3) + "1" + supplement.slice(4);
}
