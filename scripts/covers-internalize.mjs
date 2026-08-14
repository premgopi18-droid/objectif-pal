/**
 * Rapatriement des couvertures (epic #182, Phase 2 — LE geste structurel).
 *
 * Chaque couverture externe est téléchargée UNE fois, recompressée (WebP,
 * 400 px max — l'affichage plafonne à 96×144 CSS, soit 192-288 px en retina),
 * rangée dans NOTRE bucket sous {user_id}/cover-{book_id}.webp, et le livre
 * bascule sur l'URL interne. Ce qui meurt avec le hotlink :
 *  - la panne corrélée epagine (143 couvertures qui cassent d'un coup) ;
 *  - le self-healing massif (#53 ne soigne plus que la fenêtre d'un jour) ;
 *  - les transformations d'images Vercel (nos WebP sont servis unoptimized) ;
 *  - la dépendance permanente à 6 CDN tiers.
 *
 * Ce qui ne change PAS :
 *  - le cache partagé (barcode_cache) garde l'URL SOURCE : chaque nouvel
 *    utilisateur internalise SA copie (le filtre #179 interdit de toute façon
 *    les URLs de notre bucket dans le cache commun) ;
 *  - la résolution au scan : zéro latence ajoutée — l'internalisation est un
 *    batch quotidien, la couverture externe s'affiche en attendant.
 *
 * Le préfixe cover-{book_id} distingue des photos maison ({book_id}.webp,
 * inbox-{uuid}.webp) — même bucket, mêmes policies, même traitement par
 * isHouseCoverPhotoUrl (vrai : ces fichiers sont chez nous, la réparation #53
 * les saute, et une photo maison peut toujours les remplacer).
 *
 * Usage :
 *   node scripts/covers-internalize.mjs           → internalisation réelle
 *   node scripts/covers-internalize.mjs --dry-run → liste sans toucher
 *
 * Env : NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Tourne chaque
 * jour en CI (covers.yml) et à la main.
 */

import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const isDryRun = process.argv.includes("--dry-run");

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
/** ⚠️ En phase avec KNOWN_COVER_HOSTNAMES (lib/books/cover-repair.ts) — la garde SSRF de l'app. */
const KNOWN_COVER_HOSTNAMES = [
  "static.metron.cloud",
  "books.google.com",
  "covers.openlibrary.org",
  "inventaire.io",
  "openapi.bnf.fr",
  "images.epagine.fr",
];
const GOOGLE_USER_CONTENT_SUFFIX = ".googleusercontent.com";
const OUTBOUND_USER_AGENT = "objectif-pal/1.0 (+https://objectif-pal.vercel.app)";

const MAX_PER_RUN = 250; // borne un run — le quotidien rattrape le reste
const MAX_DIMENSION = 400;
const WEBP_QUALITY = 75;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 8000;
const POLITENESS_DELAY_MS = 150;

const isKnownCoverHost = (coverUrl) => {
  try {
    const parsed = new URL(coverUrl);
    if (parsed.protocol !== "https:") return false;
    return KNOWN_COVER_HOSTNAMES.includes(parsed.hostname) || parsed.hostname.endsWith(GOOGLE_USER_CONTENT_SUFFIX);
  } catch {
    return false;
  }
};

const internalPrefix = `${url}/storage/v1/object/public/${COVERS_BUCKET}/`;

// Les candidats : couvertures externes de livres vivants, bornés par run.
const { data: candidates, error: selectError } = await admin
  .from("books")
  .select("id, user_id, cover_url")
  .not("cover_url", "is", null)
  .not("cover_url", "like", `${internalPrefix}%`)
  .is("deleted_at", null)
  .order("created_at", { ascending: true })
  .limit(MAX_PER_RUN);
if (selectError) throw new Error(`books : ${selectError.message}`);

console.log(`${candidates.length} couvertures externes à rapatrier${isDryRun ? " (dry-run)" : ""}`);
if (isDryRun) {
  const byHost = {};
  for (const book of candidates) {
    const host = (() => { try { return new URL(book.cover_url).hostname; } catch { return "invalide"; } })();
    byHost[host] = (byHost[host] ?? 0) + 1;
  }
  console.log(JSON.stringify(byHost, null, 1));
}

let internalized = 0;
let skipped = 0;
const failuresByHost = {};

for (const book of isDryRun ? [] : candidates) {
  await sleep(POLITENESS_DELAY_MS);
  const host = (() => { try { return new URL(book.cover_url).hostname; } catch { return "invalide"; } })();
  try {
    // Même frontière que la garde SSRF de l'app : hôte connu ou rien.
    if (!isKnownCoverHost(book.cover_url)) {
      skipped++;
      continue;
    }
    const response = await fetch(book.cover_url, {
      headers: { "User-Agent": OUTBOUND_USER_AGENT },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) throw new Error(`content-type ${contentType || "absent"}`);
    const source = Buffer.from(await response.arrayBuffer());
    if (source.length === 0 || source.length > MAX_SOURCE_BYTES) throw new Error(`taille ${source.length}`);

    const webp = await sharp(source)
      .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();

    const path = `${book.user_id}/cover-${book.id}.webp`;
    const { error: uploadError } = await admin.storage
      .from(COVERS_BUCKET)
      .upload(path, webp, { contentType: "image/webp", upsert: true });
    if (uploadError) throw new Error(`upload : ${uploadError.message}`);

    // Optimiste : on ne bascule que si la couverture n'a pas changé entre-temps
    // (photo maison posée, réparation #53…) — le perdant laisse juste un
    // fichier que la purge mensuelle (#205) ramassera.
    const internalUrl = `${internalPrefix}${path}`;
    const { error: updateError } = await admin
      .from("books")
      .update({ cover_url: internalUrl })
      .eq("id", book.id)
      .eq("cover_url", book.cover_url);
    if (updateError) throw new Error(`update : ${updateError.message}`);
    internalized++;
  } catch (error) {
    failuresByHost[host] = (failuresByHost[host] ?? 0) + 1;
    console.error(` - échec ${host} (livre ${book.id.slice(0, 8)}…) : ${error instanceof Error ? error.message : error}`);
  }
}

if (!isDryRun) console.log(`${internalized} rapatriées, ${skipped} hôtes inconnus sautés, échecs par hôte : ${JSON.stringify(failuresByHost)}`);
// Les échecs sont NORMAUX (liens déjà morts — la réparation #53 les traite) :
// le run n'échoue que si RIEN n'a pu être rapatrié alors qu'il y avait à faire.
if (internalized === 0 && candidates.length > 0 && Object.keys(failuresByHost).length > 0) {
  console.error("Aucun rapatriement réussi — panne réseau ou bucket ?");
  process.exit(1);
}
console.log("Rapatriement terminé.");
