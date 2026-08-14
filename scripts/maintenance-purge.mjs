/**
 * Purge de maintenance mensuelle (epic #182, Phase 1) — les deux ménages que
 * rien ne faisait :
 *
 *  1. STORAGE : les photos orphelines du bucket covers — une photo de rafale
 *     jamais finalisée, un scan écarté, un livre re-couvert… n'était JAMAIS
 *     supprimée (zéro storage.remove() dans l'app avant la suppression de
 *     compte). Une photo est GARDÉE si elle est référencée par books.cover_url
 *     (même soft-supprimé : la résurrection au rescan existe, §4.2) ou par une
 *     ligne scan_inbox EN ATTENTE. Marge de sécurité : on ne touche pas aux
 *     objets de moins de 7 jours (une rafale en cours n'a pas fini son chemin).
 *
 *  2. BASE : les barcode_misses de plus de 90 jours (le TTL de retente est de
 *     7 j — au-delà de 90, la ligne ne sert plus qu'à grossir la table ;
 *     purge notée dès la migration #184).
 *
 * Usage :
 *   node scripts/maintenance-purge.mjs           → purge réelle
 *   node scripts/maintenance-purge.mjs --dry-run → liste sans supprimer
 *
 * Env : NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (lus de
 * l'environnement, ou de .env.local en local). Tourne en CI mensuelle
 * (maintenance.yml) et à la main.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const isDryRun = process.argv.includes("--dry-run");

// En local, .env.local complète l'environnement (jamais l'inverse).
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq < 1 || line.startsWith("#")) continue;
    const key = line.slice(0, eq).trim();
    if (!process.env[key]) process.env[key] = line.slice(eq + 1).trim();
  }
} catch {
  // Pas de .env.local (CI) : l'environnement doit suffire.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

const COVERS_BUCKET = "covers";
const SAFETY_AGE_DAYS = 7;
const MISSES_RETENTION_DAYS = 90;
const PAGE = 100;

/** Le chemin {user_id}/{fichier} d'une URL publique du bucket — null si autre. */
const publicUrlToPath = (coverUrl) => {
  const prefix = `${url}/storage/v1/object/public/${COVERS_BUCKET}/`;
  if (!coverUrl || !coverUrl.startsWith(prefix)) return null;
  // La version de cache (?v=…) ne fait pas partie du chemin objet.
  return decodeURIComponent(coverUrl.slice(prefix.length).split("?")[0]);
};

// ── 1. Les chemins RÉFÉRENCÉS — books (soft-supprimés compris) et inbox en attente.
const referenced = new Set();
for (const source of [
  { table: "books", column: "cover_url", filter: (q) => q },
  { table: "scan_inbox", column: "cover_url", filter: (q) => q.eq("status", "pending").is("deleted_at", null) },
]) {
  for (let from = 0; ; from += 1000) {
    const query = source.filter(admin.from(source.table).select(source.column).not(source.column, "is", null));
    const { data, error } = await query.range(from, from + 999);
    if (error) throw new Error(`${source.table} : ${error.message}`);
    for (const row of data) {
      const path = publicUrlToPath(row[source.column]);
      if (path) referenced.add(path);
    }
    if (data.length < 1000) break;
  }
}
console.log(`${referenced.size} photos référencées`);

// ── 2. Balayage du bucket, dossier par dossier (un dossier = un utilisateur).
const cutoff = Date.now() - SAFETY_AGE_DAYS * 86_400_000;
const orphans = [];
const { data: folders, error: rootError } = await admin.storage.from(COVERS_BUCKET).list("", { limit: 1000 });
if (rootError) throw new Error(`storage racine : ${rootError.message}`);
for (const folder of folders ?? []) {
  if (folder.id !== null) continue; // un objet à la racine (jamais produit par l'app) : on ne touche pas
  for (let offset = 0; ; offset += PAGE) {
    const { data: objects, error } = await admin.storage.from(COVERS_BUCKET).list(folder.name, { limit: PAGE, offset });
    if (error) throw new Error(`storage ${folder.name} : ${error.message}`);
    for (const object of objects ?? []) {
      const path = `${folder.name}/${object.name}`;
      const createdAt = Date.parse(object.created_at ?? "");
      if (Number.isFinite(createdAt) && createdAt > cutoff) continue; // marge de sécurité
      if (!referenced.has(path)) orphans.push(path);
    }
    if (!objects || objects.length < PAGE) break;
  }
}
console.log(`${orphans.length} photos orphelines (de plus de ${SAFETY_AGE_DAYS} j)`);

if (!isDryRun && orphans.length > 0) {
  for (let start = 0; start < orphans.length; start += PAGE) {
    const { error } = await admin.storage.from(COVERS_BUCKET).remove(orphans.slice(start, start + PAGE));
    if (error) throw new Error(`storage remove : ${error.message}`);
  }
  console.log("orphelines supprimées");
} else if (orphans.length > 0) {
  for (const path of orphans) console.log(" -", path);
}

// ── 3. Les misses fossiles.
const missesCutoff = new Date(Date.now() - MISSES_RETENTION_DAYS * 86_400_000).toISOString();
if (isDryRun) {
  const { count } = await admin
    .from("barcode_misses")
    .select("barcode", { count: "exact", head: true })
    .lt("last_checked_at", missesCutoff);
  console.log(`${count ?? 0} barcode_misses de plus de ${MISSES_RETENTION_DAYS} j (dry-run)`);
} else {
  const { error } = await admin.from("barcode_misses").delete().lt("last_checked_at", missesCutoff);
  if (error) throw new Error(`barcode_misses : ${error.message}`);
  console.log("misses fossiles purgées");
}

console.log(isDryRun ? "Dry-run terminé — rien n'a été supprimé." : "Purge terminée.");
