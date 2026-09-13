/**
 * Purge de maintenance mensuelle (epic #182, Phase 1) — les deux ménages que
 * rien ne faisait :
 *
 *  1. STORAGE : les objets orphelins du bucket covers — une photo de rafale
 *     jamais finalisée, un scan écarté, un livre re-couvert… n'était JAMAIS
 *     supprimée (zéro storage.remove() dans l'app avant la suppression de
 *     compte). Un objet est GARDÉ s'il est référencé par books.cover_url
 *     (même soft-supprimé : la résurrection au rescan existe, §4.2), par une
 *     ligne scan_inbox EN ATTENTE, ou par une contribution vivante du pool
 *     partagé (#278). Marge de sécurité : on ne touche pas aux objets de moins
 *     de 7 jours (une rafale en cours n'a pas fini son chemin).
 *
 *  2. BASE : les barcode_misses de plus de 90 jours (le TTL de retente est de
 *     7 j — au-delà de 90, la ligne ne sert plus qu'à grossir la table ;
 *     purge notée dès la migration #184).
 *
 * En TypeScript (`tsx`) depuis l'audit #274 : le bucket et la lecture d'un
 * chemin depuis une URL publique (`coverStoragePathFromUrl`, sur l'URL PARSÉE
 * — la leçon review #183 que la copie `.mjs` n'appliquait pas) sont IMPORTÉS
 * de l'app.
 *
 * Usage :
 *   npm run maintenance:purge             → purge réelle
 *   npm run maintenance:purge -- --dry-run → liste sans supprimer
 *
 * Env : NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (lus de
 * l'environnement, ou de .env.local en local). Tourne en CI mensuelle
 * (maintenance.yml) et à la main.
 */

import { COVERS_BUCKET, coverStoragePathFromUrl } from "@/lib/books/cover-photo";
import { createAdminClientFromEnv, isDryRun } from "./lib/env.mjs";
import { isOrphan } from "./maintenance-verdict.mjs";

const dryRun = isDryRun();
const { url, admin } = createAdminClientFromEnv();

const SAFETY_AGE_DAYS = 7;
const MISSES_RETENTION_DAYS = 90;
const PAGE = 100;
const ROWS_PER_PAGE = 1000;

// ── 1. Les chemins RÉFÉRENCÉS — books (soft-supprimés compris), inbox en
//       attente, contributions vivantes du pool (#278).
const referenced = new Set<string>();
type CoverRow = { cover_url: string | null };
type CoverPage = PromiseLike<{ data: CoverRow[] | null; error: { message: string } | null }>;
const sources: { table: string; page: (from: number, to: number) => CoverPage }[] = [
  { table: "books", page: (from, to) => admin.from("books").select("cover_url").not("cover_url", "is", null).range(from, to) },
  {
    table: "scan_inbox",
    page: (from, to) => admin.from("scan_inbox").select("cover_url").not("cover_url", "is", null).eq("status", "pending").is("deleted_at", null).range(from, to),
  },
  {
    table: "cover_contributions",
    page: (from, to) => admin.from("cover_contributions").select("cover_url").not("cover_url", "is", null).is("deleted_at", null).range(from, to),
  },
];

for (const source of sources) {
  for (let from = 0; ; from += ROWS_PER_PAGE) {
    const { data, error } = await source.page(from, from + ROWS_PER_PAGE - 1);
    if (error) throw new Error(`${source.table} : ${error.message}`);
    for (const row of data ?? []) {
      const path = coverStoragePathFromUrl(row.cover_url, url);
      if (path) referenced.add(path);
    }
    if (!data || data.length < ROWS_PER_PAGE) break;
  }
}
console.log(`${referenced.size} objets référencés`);

// ── 2. Balayage du bucket, dossier par dossier (un dossier = un utilisateur,
//       plus le dossier commun `shared/` à deux niveaux).
const cutoff = Date.now() - SAFETY_AGE_DAYS * 86_400_000;
const orphans: string[] = [];
const { data: folders, error: rootError } = await admin.storage.from(COVERS_BUCKET).list("", { limit: 1000 });
if (rootError) throw new Error(`storage racine : ${rootError.message}`);

/** Balaye un dossier page par page ; un sous-dossier (id null) est descendu. La décision est pure et testée. */
async function walk(prefix: string): Promise<void> {
  for (let offset = 0; ; offset += PAGE) {
    const { data: objects, error } = await admin.storage.from(COVERS_BUCKET).list(prefix, { limit: PAGE, offset });
    if (error) throw new Error(`storage ${prefix} : ${error.message}`);
    for (const object of objects ?? []) {
      const path = `${prefix}/${object.name}`;
      if (object.id === null) {
        await walk(path);
        continue;
      }
      if (isOrphan({ path, createdAt: object.created_at, referenced, cutoffMs: cutoff })) orphans.push(path);
    }
    if (!objects || objects.length < PAGE) break;
  }
}
for (const folder of folders ?? []) {
  if (folder.id !== null) continue; // un objet à la racine (jamais produit par l'app) : on ne touche pas
  await walk(folder.name);
}
console.log(`${orphans.length} objets orphelins (de plus de ${SAFETY_AGE_DAYS} j)`);

if (!dryRun && orphans.length > 0) {
  for (let start = 0; start < orphans.length; start += PAGE) {
    const { error } = await admin.storage.from(COVERS_BUCKET).remove(orphans.slice(start, start + PAGE));
    if (error) throw new Error(`storage remove : ${error.message}`);
  }
  console.log("orphelins supprimés");
} else if (orphans.length > 0) {
  for (const path of orphans) console.log(" -", path);
}

// ── 3. Les misses fossiles.
const missesCutoff = new Date(Date.now() - MISSES_RETENTION_DAYS * 86_400_000).toISOString();
if (dryRun) {
  const { count } = await admin.from("barcode_misses").select("barcode", { count: "exact", head: true }).lt("last_checked_at", missesCutoff);
  console.log(`${count ?? 0} barcode_misses de plus de ${MISSES_RETENTION_DAYS} j (dry-run)`);
} else {
  const { error } = await admin.from("barcode_misses").delete().lt("last_checked_at", missesCutoff);
  if (error) throw new Error(`barcode_misses : ${error.message}`);
  console.log("misses fossiles purgées");
}

console.log(dryRun ? "Dry-run terminé — rien n'a été supprimé." : "Purge terminée.");
