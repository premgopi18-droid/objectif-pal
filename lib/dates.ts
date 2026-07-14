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
