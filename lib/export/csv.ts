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
 * Des lignes homogènes → un CSV avec en-tête. Les colonnes viennent des
 * `headers` explicites quand ils sont fournis (une table VIDE sort quand même
 * sa ligne d'en-tête : un fichier de 0 octet est indistinguable d'un export
 * raté), sinon de la première ligne.
 */
export function toCsv(rows: Record<string, unknown>[], headers?: string[]): string {
  const columns = headers ?? (rows[0] ? Object.keys(rows[0]) : []);
  if (columns.length === 0) return "";
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => escapeField(row[column])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
