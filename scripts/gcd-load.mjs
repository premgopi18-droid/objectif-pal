/**
 * Charge les CSV GCD (produits par gcd-export.mjs) dans Supabase, via COPY.
 *
 * STAGING + BASCULE (issue #182, Phase 1) : l'ancien truncate+COPY dans une
 * transaction posait un verrou exclusif sur gcd_issues (559 k lignes) pendant
 * tout le chargement (~3 min) — chaque scan de chaque utilisateur bloquait.
 * Désormais : on charge une table de staging pendant que la prod sert, puis
 * on bascule en UNE transaction courte (drop + rename) — indisponibilité de
 * quelques millisecondes.
 *
 * Ce que la bascule doit préserver (et que CREATE TABLE LIKE ne copie pas) :
 *  - la RLS et la policy de lecture → recréées sur le staging AVANT la bascule ;
 *  - les NOMS d'index canoniques → renommés après la bascule (la certification
 *    de dérive #197 diffe les noms de prod contre migrations/, elle hurlerait).
 *
 * Garde-fou : un CSV tronqué (export raté) ne remplace jamais une bonne table —
 * le staging doit porter au moins 90 % des lignes actuelles.
 *
 * Ces tables sont JETABLES (specs §6), entièrement reconstructibles depuis le
 * dump. Le cache de résolutions (barcode_cache) n'est jamais touché ici.
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
    readPolicy: "gcd_issues_read",
  },
  {
    name: "gcd_series",
    csv: new URL("../data/gcd_series.csv", import.meta.url),
    columns: ["id", "name", "format", "year_began", "publisher", "language_id"],
    readPolicy: "gcd_series_read",
  },
];

/** Sous ce ratio staging/prod, l'export est suspect : on ne bascule pas. */
const MINIMUM_ROW_RATIO = 0.9;

const client = new pg.Client({
  connectionString: env.SUPABASE_DB_URL,
  // Vérification du certificat désactivée : le TLS local est intercepté par l'antivirus,
  // et le pooler Supabase n'est pas toujours relié à une CA connue de Node. Acceptable
  // pour CE script batch local uniquement — ne jamais recopier dans du code serveur de
  // l'app (les Route Handlers passent par @supabase/ssr, jamais par une connexion pg).
  ssl: { rejectUnauthorized: false },
});

await client.connect();

try {
  // ── 1. Chargement des stagings — la prod SERT pendant ce temps. ──────────
  // Snapshot des index de prod AVANT toute bascule : INCLUDING ALL régénère
  // les noms depuis les colonnes, pas depuis les noms historiques (vécu à la
  // première exécution : gcd_issues_series_id_idx → …_series_id_number_idx,
  // dérive attrapée par la certification #197). On renommera par
  // correspondance de DÉFINITION, vers les noms d'origine.
  const canonicalIndexes = new Map(); // normalizedDef -> indexname
  for (const table of TABLES) {
    const { rows } = await client.query(
      `select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = $1`,
      [table.name],
    );
    for (const row of rows) canonicalIndexes.set(row.indexdef.replace(row.indexname, "@"), row.indexname);
  }

  for (const table of TABLES) {
    const staging = `${table.name}_staging`;
    await client.query(`drop table if exists ${staging}`);
    // INCLUDING ALL : colonnes, types, defaults, contraintes ET index (avec
    // des noms auto-générés — renommés à la bascule, étape 2).
    await client.query(`create table ${staging} (like ${table.name} including all)`);

    // NULL '' : les champs vides du CSV (barcode absent, page_count inconnu…) deviennent NULL.
    const copySql = `copy ${staging} (${table.columns.join(", ")}) from stdin with (format csv, header true, null '')`;
    const started = Date.now();
    await pipeline(createReadStream(table.csv), client.query(copyFrom(copySql)));

    const { rows } = await client.query(
      `select (select count(*)::int from ${staging}) as staged, (select count(*)::int from ${table.name}) as live`,
    );
    console.log(`${staging} : ${rows[0].staged.toLocaleString("fr-FR")} lignes en ${Math.round((Date.now() - started) / 1000)} s (prod : ${rows[0].live.toLocaleString("fr-FR")})`);
    // Garde-fou : un CSV tronqué ne remplace jamais une bonne table.
    if (rows[0].live > 0 && rows[0].staged < rows[0].live * MINIMUM_ROW_RATIO) {
      throw new Error(`${staging} : ${rows[0].staged} lignes contre ${rows[0].live} en prod — export suspect, bascule refusée`);
    }

    // La RLS et la policy de lecture suivent la table à travers le rename —
    // posées sur le staging AVANT la bascule, mêmes définitions que la
    // migration initiale (des tables publiques en lecture seule).
    await client.query(`alter table ${staging} enable row level security`);
    await client.query(`create policy "${table.readPolicy}" on ${staging} for select to authenticated using (true)`);
  }

  // ── 2. La bascule — UNE transaction courte, indisponibilité en ms. ────────
  await client.query("begin");
  for (const table of TABLES) {
    await client.query(`drop table ${table.name}`);
    await client.query(`alter table ${table.name}_staging rename to ${table.name}`);
  }
  // Retour aux noms d'index CANONIQUES par correspondance de définition (la
  // certification de dérive #197 diffe les noms de prod contre migrations/) :
  // le snapshot d'avant-bascule fait foi, le nom auto-généré n'est qu'un
  // véhicule temporaire.
  for (const table of TABLES) {
    const { rows } = await client.query(
      `select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = $1`,
      [table.name],
    );
    for (const row of rows) {
      const canonical = canonicalIndexes.get(row.indexdef.replace(row.indexname, "@"));
      if (!canonical) throw new Error(`index sans équivalent canonique : ${row.indexname} — bascule annulée`);
      if (canonical !== row.indexname) {
        await client.query(`alter index ${row.indexname} rename to ${canonical}`);
      }
    }
  }
  await client.query("commit");
  console.log("Bascule faite — chargement terminé.");
} catch (error) {
  // Si la connexion est morte, le rollback échoue aussi : on ne masque pas l'erreur
  // d'origine (la transaction non commitée meurt de toute façon avec la connexion).
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  await client.end();
}
