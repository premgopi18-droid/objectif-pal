/**
 * Le parseur de numéros de tome — UN seul, pur, partagé (lot 0 de l'epic
 * séries #289, specs §4.17).
 *
 * Les sources écrivent le numéro comme elles veulent : « 18 », « Tome 1 »,
 * « [Volume 7] », « vol. 2 », « t 6 », « tome I », « volume deux »,
 * « [Quatrième volume] », « chapitre premier » (mesuré sur 88 notices BnF le
 * 13/09/2026). L'app, elle, ne veut qu'une chose : une chaîne DÉCIMALE
 * canonique (« 02 » → « 2 ») ou `null` — jamais un texte qui « ressemble » à
 * un numéro. Un tome faux serait pire qu'un tome absent (règle de #30) : tout
 * ce qui n'est pas reconnu sans ambiguïté est rejeté (dates, « 41 (842) »,
 * « 4 Pre-Order Edition », le « [nn] » de GCD).
 */

/** Les mots qui annoncent un numéro — acceptés avant OU après le nombre. */
const VOLUME_WORD = String.raw`(?:tome|t\.?|vol\.?|volume|livre|chapitre|partie|n°|no\.?|#)`;

const ROMAN_NUMERAL_VALUES: Record<string, number> = { i: 1, v: 5, x: 10, l: 50 };

/** Les nombres en lettres (cardinaux et ordinaux) rencontrés dans les notices françaises. */
const FRENCH_NUMBER_WORDS: Record<string, number> = {
  un: 1, une: 1, premier: 1, première: 1,
  deux: 2, deuxième: 2, second: 2, seconde: 2,
  trois: 3, troisième: 3,
  quatre: 4, quatrième: 4,
  cinq: 5, cinquième: 5,
  six: 6, sixième: 6,
  sept: 7, septième: 7,
  huit: 8, huitième: 8,
  neuf: 9, neuvième: 9,
  dix: 10, dixième: 10,
  onze: 11, onzième: 11,
  douze: 12, douzième: 12,
  treize: 13, treizième: 13,
  quatorze: 14, quatorzième: 14,
  quinze: 15, quinzième: 15,
  seize: 16, seizième: 16,
  "dix-sept": 17, "dix-septième": 17,
  "dix-huit": 18, "dix-huitième": 18,
  "dix-neuf": 19, "dix-neuvième": 19,
  vingt: 20, vingtième: 20,
};

const parseRomanNumeral = (text: string): number | null => {
  if (!/^[ivxl]+$/.test(text)) return null;
  let total = 0;
  for (let index = 0; index < text.length; index += 1) {
    const value = ROMAN_NUMERAL_VALUES[text[index]];
    const next = ROMAN_NUMERAL_VALUES[text[index + 1]] ?? 0;
    total += value < next ? -value : value;
  }
  return total > 0 ? total : null;
};

/**
 * Le nombre porté par un fragment déjà isolé (« 02 », « iv », « deux »), ou
 * `null`. Les zéros de tête tombent : « 02 » et « 2 » sont le même tome.
 */
const parseBareNumber = (fragment: string): number | null => {
  if (/^\d+$/.test(fragment)) return Number(fragment);
  return FRENCH_NUMBER_WORDS[fragment] ?? parseRomanNumeral(fragment);
};

const NUMBER_TOKEN = String.raw`([\p{L}\d-]+)`;
const LEADING_WORD_PATTERN = new RegExp(`^${VOLUME_WORD}\\s*${NUMBER_TOKEN}$`, "u");
const TRAILING_WORD_PATTERN = new RegExp(`^${NUMBER_TOKEN}\\s+${VOLUME_WORD}$`, "u");
const BARE_PATTERN = new RegExp(`^${NUMBER_TOKEN}$`, "u");

/**
 * Le numéro de tome canonique d'un texte libre, ou `null` s'il n'est pas
 * reconnu sans ambiguïté. Crochets et parenthèses sont ignorés comme
 * caractères (« [Tome 1] »), jamais comme groupe : « 41 (842) » devient
 * « 41 842 », qui n'est pas un numéro — et c'est voulu.
 */
export function parseVolumeNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw
    .toLowerCase()
    .replace(/[[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.$/, "");
  if (!text) return null;

  const match = LEADING_WORD_PATTERN.exec(text) ?? TRAILING_WORD_PATTERN.exec(text) ?? BARE_PATTERN.exec(text);
  if (!match) return null;
  const value = parseBareNumber(match[1]);
  return value === null ? null : String(value);
}
