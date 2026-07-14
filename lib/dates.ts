/**
 * Dates « calendrier » (YYYY-MM-DD), sans fuseau — le type `date` des specs §7.
 * Tout se fait en chaînes : zéro objet Date interprété en UTC, zéro décalage.
 */

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
