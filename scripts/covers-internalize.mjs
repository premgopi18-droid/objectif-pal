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
import { CoverFailure, classifyFailure, shouldFailRun } from "./covers-run-verdict.mjs";

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

/**
 * Inventaire.io : télécharger la variante redimensionnée, pas l'URL nue.
 * Mesuré le 12/09/2026 : leur cache pleine taille sert des 200 image/webp de
 * 0 octet (empoisonnés, immutables un an) — 29 livres bloquaient le run tous
 * les jours — alors que le redimensionneur régénère depuis la source. 400 px
 * = notre MAX_DIMENSION : rien à perdre. L'URL en base reste l'URL nue tant
 * que le rapatriement n'a pas réussi.
 * ⚠️ En phase avec resizedInventaireVariant (lib/resolution/providers/inventaire.ts).
 */
const downloadUrlFor = (coverUrl) => {
  try {
    const parsed = new URL(coverUrl);
    if (parsed.origin !== "https://inventaire.io") return coverUrl;
    const match = parsed.pathname.match(/^\/img\/entities\/([0-9a-f]+)$/);
    if (!match) return coverUrl;
    return `https://inventaire.io/img/entities/${MAX_DIMENSION}x${MAX_DIMENSION}/${match[1]}`;
  } catch {
    return coverUrl;
  }
};

const internalPrefix = `${url}/storage/v1/object/public/${COVERS_BUCKET}/`;

// Les candidats : couvertures externes de livres vivants, bornés par run.
const { data: candidates, error: selectError } = await admin
  .from("books")
  .select("id, user_id, cover_url")
  .not("cover_url", "is", null)
  .not("cover_url", "like", `${internalPrefix}%`)
  // Comic Vine (#279) : JAMAIS rapatrié (« ne pas reproduire sur un autre
  // support ») — exclu dès la sélection pour ne pas le compter en « hôte
  // inconnu sauté » chaque nuit. L'hôte reste absent de KNOWN_COVER_HOSTNAMES ici.
  .not("cover_url", "like", "https://comicvine.gamespot.com/%")
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
/** Les échecs par famille puis par hôte (#272) — la sortie du run en dépend. */
const failures = { corpse: {}, network: {}, infra: {} };
const countFailures = (byHost) => Object.values(byHost).reduce((sum, count) => sum + count, 0);

for (const book of isDryRun ? [] : candidates) {
  await sleep(POLITENESS_DELAY_MS);
  const host = (() => { try { return new URL(book.cover_url).hostname; } catch { return "invalide"; } })();
  try {
    // Même frontière que la garde SSRF de l'app : hôte connu ou rien.
    if (!isKnownCoverHost(book.cover_url)) {
      skipped++;
      continue;
    }
    // L'URL de téléchargement peut différer de l'URL stockée (variante
    // Inventaire) : la garde ci-dessus porte sur l'URL stockée, la variante
    // n'est dérivée que sur l'origine inventaire.io — même frontière.
    // Pas de réponse HTTP (DNS, connexion, timeout) = réseau ; une réponse qui
    // n'est pas une image exploitable = cadavre (voir covers-run-verdict.mjs).
    let response;
    try {
      response = await fetch(downloadUrlFor(book.cover_url), {
        headers: { "User-Agent": OUTBOUND_USER_AGENT },
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
    } catch (error) {
      throw new CoverFailure("network", error instanceof Error ? error.message : String(error));
    }
    if (!response.ok) throw new CoverFailure("corpse", `HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) throw new CoverFailure("corpse", `content-type ${contentType || "absent"}`);
    let source;
    try {
      source = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      // Connexion coupée en plein corps : pas de réponse complète = réseau.
      throw new CoverFailure("network", error instanceof Error ? error.message : String(error));
    }
    if (source.length === 0 || source.length > MAX_SOURCE_BYTES) throw new CoverFailure("corpse", `taille ${source.length}`);

    let webp;
    try {
      webp = await sharp(source)
        .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();
    } catch (error) {
      // Un fichier que sharp ne lit pas est un cadavre (placeholder, HTML
      // déguisé) — pas une panne de notre côté.
      throw new CoverFailure("corpse", `illisible : ${error instanceof Error ? error.message : error}`);
    }

    const path = `${book.user_id}/cover-${book.id}.webp`;
    // cacheControl 1 an : l'URL d'une couverture rapatriée ne change JAMAIS de
    // contenu (une photo maison vit à un autre chemin, la réparation #53 saute
    // nos fichiers) — chaque re-téléchargement horaire était de l'egress perdu.
    const { error: uploadError } = await admin.storage
      .from(COVERS_BUCKET)
      .upload(path, webp, { contentType: "image/webp", upsert: true, cacheControl: "31536000" });
    if (uploadError) throw new CoverFailure("infra", `upload : ${uploadError.message}`);

    // Optimiste : on ne bascule que si la couverture n'a pas changé entre-temps
    // (photo maison posée, réparation #53…) — le perdant laisse juste un
    // fichier que la purge mensuelle (#205) ramassera.
    // `?v=` (#276) : le chemin est déterministe et servi avec un cache d'un
    // an — une couverture CHOISIE à nouveau sur un livre déjà rapatrié serait
    // invisible sans version d'URL. La purge (#205) retire la query avant de
    // comparer, `isHouseCoverPhotoUrl` est un startsWith : compatibles.
    const internalUrl = `${internalPrefix}${path}?v=${Date.now()}`;
    const { error: updateError, count } = await admin
      .from("books")
      .update({ cover_url: internalUrl }, { count: "exact" })
      .eq("id", book.id)
      .eq("cover_url", book.cover_url);
    if (updateError) throw new CoverFailure("infra", `update : ${updateError.message}`);
    // Le compteur dit ce qui a VRAIMENT basculé (#275) : la course perdue
    // (photo posée entre-temps) laisse un fichier à la purge, pas un +1.
    if (count === 1) internalized++;
    else skipped++;
  } catch (error) {
    const kind = classifyFailure(error);
    failures[kind][host] = (failures[kind][host] ?? 0) + 1;
    console.error(` - ${kind} ${host} (livre ${book.id.slice(0, 8)}…) : ${error instanceof Error ? error.message : error}`);
  }
}

const counts = {
  internalized,
  corpse: countFailures(failures.corpse),
  network: countFailures(failures.network),
  infra: countFailures(failures.infra),
};
if (!isDryRun) {
  console.log(
    `${internalized} rapatriées, ${skipped} hôtes inconnus sautés — cadavres ${JSON.stringify(failures.corpse)}, ` +
      `réseau ${JSON.stringify(failures.network)}, infra ${JSON.stringify(failures.infra)}`,
  );
}
// Les cadavres sont NORMAUX (liens morts — la réparation #53 les traite, on
// retente demain) : le run n'est rouge que sur panne d'infra ou réseau totale
// (#272, verdict pur et testé dans covers-run-verdict.mjs).
if (shouldFailRun(counts)) {
  console.error(counts.infra > 0 ? "Panne d'infra (bucket ou base) — voir les échecs ci-dessus." : "Panne réseau totale : aucune réponse HTTP reçue.");
  process.exit(1);
}
console.log("Rapatriement terminé.");
