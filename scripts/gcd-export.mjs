/**
 * Extrait du dump GCD la table de correspondance `barcode → issue`, en CSV prêt pour Supabase.
 *
 * On ne garde que ce qui sert à identifier un bouquin scanné :
 *   - les issues QUI ONT un code-barres (423 907 sur 2,58 M) ;
 *   - les séries et éditeurs correspondants, pour l'affichage.
 *
 * Le dump sort ses tables par ordre alphabétique (gcd_issue AVANT gcd_series), donc on
 * bufferise les issues retenues en mémoire (~420 k lignes, quelques dizaines de Mo) et on
 * n'écrit qu'à la fin, une fois les séries connues.
 *
 * Usage :
 *   node scripts/gcd-export.mjs "C:/Users/premg/Downloads/current/2026-07-01.sql"
 *
 * Produit dans data/ :
 *   gcd_issues.csv     barcode, barcode_prefix, series_id, number, page_count, key_date, isbn, title
 *   gcd_series.csv     id, name, format, year_began, publisher_name, language_id
 *
 * Licence : données GCD en CC BY-SA 4.0 → l'app DOIT créditer la Grand Comics Database.
 */

import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";

const dumpPath = process.argv[2];
if (!dumpPath) {
  console.error('Usage : node scripts/gcd-export.mjs "<chemin vers le .sql>"');
  process.exit(1);
}

const OUTPUT_DIRECTORY = new URL("../data/", import.meta.url);
const TRACKED_TABLES = new Set(["gcd_issue", "gcd_series", "gcd_publisher"]);

/** Découpe les valeurs d'un INSERT MySQL en lignes de champs. */
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
          const next = values[index + 1];
          field += next === "n" ? " " : next === "t" ? " " : next;
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

const toCsvField = (value) => {
  const text = String(value ?? "").replace(/\r?\n/g, " ").trim();
  return /[",;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const toCsvLine = (fields) => fields.map(toCsvField).join(",") + "\n";

const columnsByTable = new Map();
let currentCreateTable = null;

const issues = []; // { barcode, prefix, seriesId, number, pageCount, keyDate, isbn, title }
const seriesById = new Map();
const publisherNameById = new Map();

const stream = createInterface({
  input: createReadStream(dumpPath, { encoding: "utf8" }),
  crlfDelay: Infinity,
});

console.log("Lecture du dump…");

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
        format: row[at("format")],
        yearBegan: row[at("year_began")],
        publisherId: row[at("publisher_id")],
        languageId: row[at("language_id")],
      });
      continue;
    }

    // gcd_issue
    if (row[at("deleted")] === "1") continue;

    const rawBarcode = (row[at("barcode")] ?? "").trim();
    if (!rawBarcode) continue;

    // GCD sépare parfois plusieurs codes (variantes) par ';' ou espace : une ligne par code.
    const codes = rawBarcode.split(/[;\s]+/).filter((code) => /^\d{8,}$/.test(code));

    for (const barcode of codes) {
      issues.push({
        barcode,
        // Les 12 premiers chiffres identifient le TITRE : c'est ce qui permet de retrouver
        // la série quand le scan rate le supplément de 5 chiffres.
        prefix: barcode.slice(0, 12),
        seriesId: row[at("series_id")],
        number: row[at("number")],
        pageCount: row[at("page_count")] === "NULL" ? "" : row[at("page_count")],
        keyDate: row[at("key_date")],
        isbn: row[at("valid_isbn")] || row[at("isbn")] || "",
        title: row[at("title")],
      });
    }
  }
}

console.log(`\n${issues.length.toLocaleString("fr-FR")} lignes barcode retenues. Écriture des CSV…`);

await mkdir(OUTPUT_DIRECTORY, { recursive: true });

const issuesFile = createWriteStream(new URL("gcd_issues.csv", OUTPUT_DIRECTORY));
issuesFile.write("barcode,barcode_prefix,series_id,number,page_count,key_date,isbn,title\n");

// On ne garde que les séries réellement référencées par une issue code-barrée.
const usedSeriesIds = new Set();

for (const issue of issues) {
  usedSeriesIds.add(issue.seriesId);
  issuesFile.write(
    toCsvLine([
      issue.barcode,
      issue.prefix,
      issue.seriesId,
      issue.number,
      issue.pageCount,
      issue.keyDate,
      issue.isbn,
      issue.title,
    ]),
  );
}
issuesFile.end();

const seriesFile = createWriteStream(new URL("gcd_series.csv", OUTPUT_DIRECTORY));
seriesFile.write("id,name,format,year_began,publisher,language_id\n");

for (const seriesId of usedSeriesIds) {
  const series = seriesById.get(seriesId);
  if (!series) continue;
  seriesFile.write(
    toCsvLine([
      seriesId,
      series.name,
      series.format,
      series.yearBegan,
      publisherNameById.get(series.publisherId) ?? "",
      series.languageId,
    ]),
  );
}
seriesFile.end();

console.log(`  data/gcd_issues.csv  → ${issues.length.toLocaleString("fr-FR")} lignes`);
console.log(`  data/gcd_series.csv  → ${usedSeriesIds.size.toLocaleString("fr-FR")} séries`);
console.log("\nPrêt à charger dans Supabase (COPY).");
