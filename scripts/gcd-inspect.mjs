/**
 * Inspecte le dump MySQL de la Grand Comics Database, en flux.
 *
 * But : savoir si une table de correspondance `barcode → issue` tient dans les 500 Mo
 * du plan gratuit Supabase (cf. docs/product-specs.md). On compte, on ne suppose pas.
 *
 * Le dump fait ~3,8 Go : on ne le charge jamais en mémoire, on le lit ligne par ligne.
 *
 * Usage :
 *   node scripts/gcd-inspect.mjs "C:/Users/premg/Downloads/current/2026-07-01.sql"
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const dumpPath = process.argv[2];
if (!dumpPath) {
  console.error('Usage : node scripts/gcd-inspect.mjs "<chemin vers le .sql>"');
  process.exit(1);
}

// Les seules tables qui nous intéressent pour identifier un bouquin scanné.
const TRACKED_TABLES = new Set(["gcd_issue", "gcd_series", "gcd_publisher", "gcd_language"]);

/**
 * Découpe une liste de valeurs MySQL `(1,'a',NULL),(2,'b',3)` en tableaux de champs.
 * Gère les quotes simples, les échappements backslash et NULL.
 */
function* parseRows(values) {
  let index = 0;

  while (index < values.length) {
    if (values[index] !== "(") {
      index += 1;
      continue;
    }

    index += 1; // on entre dans la ligne
    const fields = [];
    let field = "";
    let inString = false;

    while (index < values.length) {
      const char = values[index];

      if (inString) {
        if (char === "\\") {
          // Séquence échappée : on garde le caractère suivant tel quel.
          const next = values[index + 1];
          field += next === "n" ? "\n" : next === "t" ? "\t" : next;
          index += 2;
          continue;
        }
        if (char === "'") {
          // Deux quotes collées = une quote littérale.
          if (values[index + 1] === "'") {
            field += "'";
            index += 2;
            continue;
          }
          inString = false;
          index += 1;
          continue;
        }
        field += char;
        index += 1;
        continue;
      }

      if (char === "'") {
        inString = true;
        index += 1;
        continue;
      }
      if (char === ",") {
        fields.push(field);
        field = "";
        index += 1;
        continue;
      }
      if (char === ")") {
        fields.push(field);
        index += 1;
        break;
      }

      field += char;
      index += 1;
    }

    yield fields;
  }
}

/** L'ordre des colonnes vient du CREATE TABLE : les INSERT du dump n'en listent pas. */
const columnsByTable = new Map();
let currentCreateTable = null;

const series = new Map(); // id → { name, publisherId, languageId, formatLength }
const publishers = new Map(); // id → nom
const languages = new Map(); // id → code

const issueStats = {
  total: 0,
  deleted: 0,
  withBarcode: 0,
  withIsbn: 0,
  variants: 0,
  bytesForSlimTable: 0,
  byLanguage: new Map(),
};

const stream = createInterface({
  input: createReadStream(dumpPath, { encoding: "utf8" }),
  crlfDelay: Infinity,
});

let lineCount = 0;
console.log("Lecture du dump…\n");

for await (const line of stream) {
  lineCount += 1;
  if (lineCount % 200_000 === 0) process.stdout.write(".");

  // 1. Mémoriser l'ordre des colonnes de chaque table suivie.
  const createMatch = line.match(/^CREATE TABLE `(\w+)`/);
  if (createMatch) {
    currentCreateTable = TRACKED_TABLES.has(createMatch[1]) ? createMatch[1] : null;
    if (currentCreateTable) columnsByTable.set(currentCreateTable, []);
    continue;
  }
  if (currentCreateTable) {
    const columnMatch = line.match(/^\s+`(\w+)`\s/);
    if (columnMatch) columnsByTable.get(currentCreateTable).push(columnMatch[1]);
    if (line.startsWith(")")) currentCreateTable = null;
    continue;
  }

  // 2. Traiter les INSERT des tables suivies.
  const insertMatch = line.match(/^INSERT INTO `(\w+)` VALUES /);
  if (!insertMatch) continue;

  const table = insertMatch[1];
  if (!TRACKED_TABLES.has(table)) continue;

  const columns = columnsByTable.get(table) ?? [];
  const columnIndex = (name) => columns.indexOf(name);
  const values = line.slice(insertMatch[0].length);

  for (const row of parseRows(values)) {
    if (table === "gcd_publisher") {
      publishers.set(row[columnIndex("id")], row[columnIndex("name")]);
      continue;
    }

    if (table === "gcd_language") {
      languages.set(row[columnIndex("id")], row[columnIndex("code")] ?? row[columnIndex("name")]);
      continue;
    }

    if (table === "gcd_series") {
      series.set(row[columnIndex("id")], {
        name: row[columnIndex("name")],
        publisherId: row[columnIndex("publisher_id")],
        languageId: row[columnIndex("language_id")],
        format: row[columnIndex("format")],
      });
      continue;
    }

    // gcd_issue
    issueStats.total += 1;

    if (row[columnIndex("deleted")] === "1") {
      issueStats.deleted += 1;
      continue;
    }

    const barcode = row[columnIndex("barcode")] ?? "";
    const isbn = row[columnIndex("valid_isbn")] || row[columnIndex("isbn")] || "";
    const variantOf = row[columnIndex("variant_of_id")];

    if (isbn) issueStats.withIsbn += 1;
    if (variantOf && variantOf !== "NULL") issueStats.variants += 1;
    if (!barcode) continue;

    issueStats.withBarcode += 1;

    // Poids réel de la ligne qu'on stockerait : barcode, series_id, numéro, pages, date, isbn.
    const number = row[columnIndex("number")] ?? "";
    const pageCount = row[columnIndex("page_count")] ?? "";
    const keyDate = row[columnIndex("key_date")] ?? "";
    // +24 octets : l'overhead d'une ligne PostgreSQL.
    issueStats.bytesForSlimTable +=
      barcode.length + number.length + pageCount.length + keyDate.length + isbn.length + 4 + 24;

    const languageId = series.get(row[columnIndex("series_id")])?.languageId;
    const language = languages.get(languageId) ?? "?";
    issueStats.byLanguage.set(language, (issueStats.byLanguage.get(language) ?? 0) + 1);
  }
}

const asMegabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(0)} Mo`;

console.log("\n\n═══ DUMP GCD ═══\n");
console.log(`Éditeurs        : ${publishers.size.toLocaleString("fr-FR")}`);
console.log(`Séries          : ${series.size.toLocaleString("fr-FR")}`);
console.log(`Issues (total)  : ${issueStats.total.toLocaleString("fr-FR")}`);
console.log(`  dont supprimées : ${issueStats.deleted.toLocaleString("fr-FR")}`);
console.log(`  dont variantes  : ${issueStats.variants.toLocaleString("fr-FR")}`);

console.log(`\n─── Ce qui nous intéresse ───`);
console.log(`Issues AVEC un code-barres : ${issueStats.withBarcode.toLocaleString("fr-FR")}`);
console.log(`Issues avec un ISBN        : ${issueStats.withIsbn.toLocaleString("fr-FR")}`);

console.log(`\n─── Répartition par langue (issues avec code-barres) ───`);
const topLanguages = [...issueStats.byLanguage.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
for (const [language, count] of topLanguages) {
  console.log(`  ${language.padEnd(6)} ${count.toLocaleString("fr-FR").padStart(10)}`);
}

console.log(`\n─── Poids estimé dans Supabase ───`);
const seriesBytes = [...series.values()].reduce((total, s) => total + s.name.length + 40, 0);
// L'index B-tree sur le barcode coûte grosso modo 40 octets par ligne.
const indexBytes = issueStats.withBarcode * 40;
const total = issueStats.bytesForSlimTable + seriesBytes + indexBytes;

console.log(`  Table issues (réduite) : ${asMegabytes(issueStats.bytesForSlimTable)}`);
console.log(`  Table séries           : ${asMegabytes(seriesBytes)}`);
console.log(`  Index sur le barcode   : ${asMegabytes(indexBytes)}`);
console.log(`  ──────────────────────────────────`);
console.log(`  TOTAL                  : ${asMegabytes(total)}`);
console.log(`\n  Plafond Supabase gratuit : 500 Mo → ${total < 500 * 1024 * 1024 ? "ÇA PASSE" : "ÇA NE PASSE PAS, il faut filtrer"}`);
