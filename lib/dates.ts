/**
 * Dates « calendrier » (YYYY-MM-DD), sans fuseau — le type `date` des specs §7.
 * Tout se fait en chaînes : zéro objet Date interprété en UTC, zéro décalage.
 */

/** Une date du journal, `YYYY-MM-DD` — le FORMAT seul (le bornage calendaire est vérifié à part). */
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Vrai si la chaîne est une VRAIE date calendaire `YYYY-MM-DD` — le garde des
 * Server Actions. On teste d'abord le format, puis on reconstruit la date en
 * UTC et on vérifie que la re-sérialisation redonne exactement la chaîne : ça
 * rejette les jours/mois hors bornes (2026-13-45, 2026-02-30…) que Postgres
 * refuserait ensuite avec une erreur SQL brute.
 */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** La date locale de l'APPAREIL — jamais celle du serveur (UTC). */
export function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** `2026-07-14` → `14/07/2026` — découpage pur, aucun risque de fuseau. */
export function formatDateFrench(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

const FRENCH_MONTHS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
] as const;

/** `2026-07` → `juillet 2026`. */
export function formatMonthFrench(month: string): string {
  const [year, monthNumber] = month.split("-");
  return `${FRENCH_MONTHS[Number(monthNumber) - 1]} ${year}`;
}

/** Le mois calendaire local de l'appareil, `YYYY-MM`. */
export function localCurrentMonth(): string {
  return localToday().slice(0, 7);
}

/** `2026-07` ± n mois, en pure arithmétique de chaînes. */
export function addMonths(month: string, offset: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const total = year * 12 + (monthNumber - 1) + offset;
  // Le double modulo protège des totaux négatifs (théorique, mais gratuit).
  return `${Math.floor(total / 12)}-${String((((total % 12) + 12) % 12) + 1).padStart(2, "0")}`;
}
