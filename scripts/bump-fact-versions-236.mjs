/**
 * ONE-SHOT #236 — à lancer UNE fois après le déploiement des couvertures,
 * puis À SUPPRIMER (règle maison des one-shots).
 *
 * Périme les agrégats de TOUS les comptes (bump des user_fact_versions) pour
 * que la rematérialisation embarque les métadonnées publiques des livres
 * (couvertures, ISBN…) — le versionnage ne se déclenche pas tout seul sur un
 * changement de FORME de ligne. Ensuite : lancer le workflow « Monthly
 * reports » à la main (workflow_dispatch — dry-run d'abord si tu veux voir).
 *
 * Usage : node scripts/bump-fact-versions-236.mjs
 * Env : SUPABASE_DB_URL (lu de .env.local en local).
 * Écriture GLOBALE assumée : on périme un cache, les faits ne bougent pas —
 * c'est le seul one-shot légitimement sans filtre user_id.
 */

import { readFileSync } from "node:fs";
import pg from "pg";

try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq < 1 || line.startsWith("#")) continue;
    const key = line.slice(0, eq).trim();
    if (!process.env[key]) process.env[key] = line.slice(eq + 1).trim();
  }
} catch {
  // Pas de .env.local : l'environnement doit suffire.
}

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  // Vérification du certificat désactivée : TLS local intercepté par
  // l'antivirus (le patron des scripts batch locaux — jamais côté serveur).
  ssl: { rejectUnauthorized: false },
});
await client.connect();
try {
  const { rowCount } = await client.query("update user_fact_versions set version = version + 1");
  console.log(`✓ ${rowCount} version(s) bumpée(s) — tous les agrégats sont périmés.`);
  console.log("→ Lance maintenant le workflow « Monthly reports » (Actions → Run workflow).");
} finally {
  await client.end();
}
