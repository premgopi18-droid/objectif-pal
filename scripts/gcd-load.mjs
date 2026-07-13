/**
 * Charge les CSV GCD (produits par gcd-export.mjs) dans Supabase, via COPY.
 *
 * Dans UNE transaction : on vide et on recharge gcd_issues et gcd_series d'un bloc —
 * ce sont des tables JETABLES (specs §6), entièrement reconstructibles depuis le dump.
 * Le cache de résolutions (barcode_cache) n'est jamais touché ici.
 *
 * Usage :
 *   npm run gcd:load
 *
 * Lit SUPABASE_DB_URL dans .env.local (pooler en mode session, port 5432 — le mode
 * transaction, port 6543, coupe les COPY longs).
 */

import { createReadStream, readFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import pg from "pg";
import { from as copyFrom } from "pg-copy-streams";

// .env.local n'est pas chargé par Node : on le lit nous-mêmes, sans dépendance.
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]),
);

if (!env.SUPABASE_DB_URL) {
  console.error("SUPABASE_DB_URL manquant dans .env.local");
  process.exit(1);
}

const TABLES = [
  {
    name: "gcd_issues",
    csv: new URL("../data/gcd_issues.csv", import.meta.url),
    columns: ["gcd_id", "barcode", "barcode_prefix", "series_id", "number", "page_count", "key_date", "isbn", "title"],
  },
  {
    name: "gcd_series",
    csv: new URL("../data/gcd_series.csv", import.meta.url),
    columns: ["id", "name", "format", "year_began", "publisher", "language_id"],
  },
];

const client = new pg.Client({
  connectionString: env.SUPABASE_DB_URL,
  // Le pooler Supabase présente un certificat que Node ne relie pas toujours à une CA
  // connue ; la connexion reste chiffrée.
  ssl: { rejectUnauthorized: false },
});

await client.connect();

try {
  await client.query("begin");

  for (const table of TABLES) {
    await client.query(`truncate ${table.name}`);

    // NULL '' : les champs vides du CSV (barcode absent, page_count inconnu…) deviennent NULL.
    const copySql = `copy ${table.name} (${table.columns.join(", ")}) from stdin with (format csv, header true, null '')`;
    const started = Date.now();
    await pipeline(createReadStream(table.csv), client.query(copyFrom(copySql)));

    const { rows } = await client.query(`select count(*)::int as count from ${table.name}`);
    console.log(`${table.name} : ${rows[0].count.toLocaleString("fr-FR")} lignes en ${Math.round((Date.now() - started) / 1000)} s`);
  }

  await client.query("commit");
  console.log("Chargement terminé.");
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}
