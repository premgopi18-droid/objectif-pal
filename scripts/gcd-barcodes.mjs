/**
 * Analyse le champ `barcode` de GCD — la question qui décide de l'architecture du scan.
 *
 * Trois inconnues :
 *   1. Les barcodes stockés incluent-ils le supplément de 5 chiffres (le numéro d'issue),
 *      ou seulement les 12 chiffres de l'UPC ? C'est ce qui dit si un scan partiel suffit.
 *   2. La couverture par année : les comics récents (ceux qu'on scanne) sont-ils indexés ?
 *   3. La couverture par éditeur : l'indé est-il là, ou seulement Marvel/DC ?
 *
 * Le dump sort les tables par ordre alphabétique (gcd_issue AVANT gcd_series), donc on
 * fait deux passes : d'abord les issues en mémoire, puis les séries/éditeurs pour joindre.
 *
 * Usage : node scripts/gcd-barcodes.mjs "C:/Users/premg/Downloads/current/2026-07-01.sql"
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const dumpPath = process.argv[2];
if (!dumpPath) {
  console.error('Usage : node scripts/gcd-barcodes.mjs "<chemin vers le .sql>"');
  process.exit(1);
}

const TRACKED_TABLES = new Set(["gcd_issue", "gcd_series", "gcd_publisher"]);

function* parseRows(values) {
  let index = 0;
  while (index < values.length) {
    if (values[index] !== "(") {
      index += 1;
      continue;
    }
    index += 1;
    const fields = [];
    let field = "";
    let inString = false;

    while (index < values.length) {
      const char = values[index];
      if (inString) {
        if (char === "\\") {
          field += values[index + 1];
          index += 2;
          continue;
        }
        if (char === "'") {
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

const columnsByTable = new Map();
let currentCreateTable = null;

/** seriesId → { barcodes: n, years: [] } — on agrège les issues par série, puis on joindra. */
const barcodedIssuesBySeries = new Map();
const seriesById = new Map();
const publisherNameById = new Map();

const barcodeLengths = new Map();
const issuesByYear = new Map();
let barcodesWithSupplement = 0;
let barcodesTwelveDigits = 0;
let barcodesMultiple = 0;
let barcodesNonNumeric = 0;
let totalBarcoded = 0;

const stream = createInterface({
  input: createReadStream(dumpPath, { encoding: "utf8" }),
  crlfDelay: Infinity,
});

console.log("Lecture du dump…\n");

for await (const line of stream) {
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

  const insertMatch = line.match(/^INSERT INTO `(\w+)` VALUES /);
  if (!insertMatch) continue;

  const table = insertMatch[1];
  if (!TRACKED_TABLES.has(table)) continue;

  const columns = columnsByTable.get(table) ?? [];
  const at = (name) => columns.indexOf(name);
  const values = line.slice(insertMatch[0].length);

  for (const row of parseRows(values)) {
    if (table === "gcd_publisher") {
      publisherNameById.set(row[at("id")], row[at("name")]);
      continue;
    }

    if (table === "gcd_series") {
      seriesById.set(row[at("id")], {
        name: row[at("name")],
        publisherId: row[at("publisher_id")],
        format: row[at("format")],
      });
      continue;
    }

    // gcd_issue
    const barcode = (row[at("barcode")] ?? "").trim();
    if (!barcode) continue;

    totalBarcoded += 1;

    // GCD stocke parfois plusieurs codes séparés par ';' (variantes, éditions).
    const codes = barcode.split(/[;\s]+/).filter(Boolean);
    if (codes.length > 1) barcodesMultiple += 1;

    const first = codes[0];
    if (!/^\d+$/.test(first)) {
      barcodesNonNumeric += 1;
    } else {
      barcodeLengths.set(first.length, (barcodeLengths.get(first.length) ?? 0) + 1);
      // 17-18 chiffres = UPC (12) + supplément (5) : le numéro d'issue est dedans.
      if (first.length >= 17) barcodesWithSupplement += 1;
      if (first.length === 12 || first.length === 13) barcodesTwelveDigits += 1;
    }

    const year = (row[at("key_date")] ?? "").slice(0, 4);
    if (/^\d{4}$/.test(year)) issuesByYear.set(year, (issuesByYear.get(year) ?? 0) + 1);

    const seriesId = row[at("series_id")];
    barcodedIssuesBySeries.set(seriesId, (barcodedIssuesBySeries.get(seriesId) ?? 0) + 1);
  }
}

console.log("═══ LE CHAMP BARCODE DE GCD ═══\n");
console.log(`Issues avec un code-barres : ${totalBarcoded.toLocaleString("fr-FR")}\n`);

console.log("─── Longueur du code stocké ───");
const lengths = [...barcodeLengths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
for (const [length, count] of lengths) {
  const share = ((count / totalBarcoded) * 100).toFixed(1);
  const label = length >= 17 ? "UPC + supplément (numéro d'issue inclus)" : length <= 13 ? "UPC seul (pas de numéro)" : "";
  console.log(`  ${String(length).padStart(2)} chiffres : ${count.toLocaleString("fr-FR").padStart(9)} (${share.padStart(4)} %)  ${label}`);
}
console.log(`\n  Avec supplément (≥17)  : ${barcodesWithSupplement.toLocaleString("fr-FR")} (${((barcodesWithSupplement / totalBarcoded) * 100).toFixed(1)} %)`);
console.log(`  UPC/EAN seul (12-13)   : ${barcodesTwelveDigits.toLocaleString("fr-FR")} (${((barcodesTwelveDigits / totalBarcoded) * 100).toFixed(1)} %)`);
console.log(`  Codes multiples        : ${barcodesMultiple.toLocaleString("fr-FR")}`);
console.log(`  Non numériques         : ${barcodesNonNumeric.toLocaleString("fr-FR")}`);

console.log("\n─── Couverture par année ───");
const recentYears = [...issuesByYear.entries()].filter(([year]) => Number(year) >= 2015).sort();
for (const [year, count] of recentYears) {
  console.log(`  ${year} : ${count.toLocaleString("fr-FR").padStart(7)}`);
}

console.log("\n─── Top éditeurs (issues avec code-barres) ───");
const barcodesByPublisher = new Map();
for (const [seriesId, count] of barcodedIssuesBySeries) {
  const publisherId = seriesById.get(seriesId)?.publisherId;
  const name = publisherNameById.get(publisherId) ?? "?";
  barcodesByPublisher.set(name, (barcodesByPublisher.get(name) ?? 0) + count);
}
const topPublishers = [...barcodesByPublisher.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
for (const [name, count] of topPublishers) {
  console.log(`  ${name.slice(0, 32).padEnd(34)} ${count.toLocaleString("fr-FR").padStart(8)}`);
}
