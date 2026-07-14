/**
 * CSV minimal pour l'export (specs §4.10) — pas de dépendance : l'export doit
 * survivre à tout, y compris à l'écosystème npm.
 */

const needsQuoting = /[",;\n\r]/;

const escapeField = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return needsQuoting.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * Des lignes homogènes → un CSV avec en-tête. Les colonnes viennent de la
 * première ligne (les requêtes d'export sélectionnent des colonnes stables).
 */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeField(row[header])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
