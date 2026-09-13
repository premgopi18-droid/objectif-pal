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
 *  - la dépendance permanente aux CDN tiers — sauf Comic Vine (#279), en lien
 *    direct pour toujours (« ne pas reproduire sur un autre support »).
 *
 * Ce qui ne change PAS :
 *  - le cache partagé (barcode_cache) garde l'URL SOURCE : chaque nouvel
 *    utilisateur internalise SA copie (le filtre #179 interdit de toute façon
 *    les URLs de notre bucket dans le cache commun) ;
 *  - la résolution au scan : zéro latence ajoutée — l'internalisation est un
 *    batch quotidien, la couverture externe s'affiche en attendant.
 *
 * Le préfixe cover-{book_id} distingue des photos ({book_id}.webp,
 * inbox-{uuid}.webp) — même bucket, mêmes policies ; `isHouseCoverPhotoUrl`
 * les reconnaît (chez nous : pas d'optimiseur, pas de réparation #53), et
 * depuis #275 toute couverture — rapatriée comprise — se remplace à volonté.
 *
 * En TypeScript (`tsx`) depuis l'audit #274 : la frontière des hôtes
 * (`isInternalizableCoverUrl`), le bucket, la variante Inventaire et l'UA sont
 * IMPORTÉS de l'app — plus de liste recopiée « en phase avec » qui dérive.
 *
 * Usage :
 *   npm run covers:internalize             → internalisation réelle
 *   npm run covers:internalize -- --dry-run → liste sans toucher
 * (node --conditions=react-server --import tsx : le garde `server-only` de
 * Next devient vide hors de Next — voir package.json)
 *
 * Env : NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Tourne chaque
 * jour en CI (covers.yml) et à la main.
 */

import { setTimeout as sleep } from "node:timers/promises";
import sharp from "sharp";
import { COVERS_BUCKET, INTERNALIZED_COVER_MAX_DIMENSION } from "@/lib/books/cover-photo";
import { isInternalizableCoverUrl } from "@/lib/books/cover-repair";
import { resizedInventaireVariant } from "@/lib/resolution/providers/inventaire";
import { OUTBOUND_USER_AGENT } from "@/lib/resolution/types";
import { createAdminClientFromEnv, isDryRun } from "./lib/env.mjs";
import { CoverFailure, classifyFailure, shouldFailRun, type CoverFailureKind } from "./covers-run-verdict.mjs";

const dryRun = isDryRun();
const { url, admin } = createAdminClientFromEnv();

const MAX_PER_RUN = 250; // borne un run — le quotidien rattrape le reste
const WEBP_QUALITY = 75;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 8000;
const POLITENESS_DELAY_MS = 150;

/**
 * Inventaire.io : télécharger la variante redimensionnée, pas l'URL nue (#270 :
 * leur cache pleine taille sert des 200 de 0 octet). La règle vit dans le
 * provider de l'app — une seule vérité.
 */
const downloadUrlFor = (coverUrl: string): string => resizedInventaireVariant(coverUrl) ?? coverUrl;

const hostOf = (coverUrl: string): string => {
  try {
    return new URL(coverUrl).hostname;
  } catch {
    return "invalide";
  }
};

const internalPrefix = `${url}/storage/v1/object/public/${COVERS_BUCKET}/`;

// Les candidats : couvertures externes de livres vivants, bornés par run.
// Comic Vine (#279) est exclu dès la sélection — jamais rapatrié — pour ne pas
// le compter en « hôte non rapatriable sauté » chaque nuit.
const { data: candidates, error: selectError } = await admin
  .from("books")
  .select("id, user_id, cover_url")
  .not("cover_url", "is", null)
  .not("cover_url", "like", `${internalPrefix}%`)
  .not("cover_url", "like", "https://comicvine.gamespot.com/%")
  .is("deleted_at", null)
  .order("created_at", { ascending: true })
  .limit(MAX_PER_RUN);
if (selectError) throw new Error(`books : ${selectError.message}`);
const books = (candidates ?? []).filter((book): book is typeof book & { cover_url: string } => book.cover_url !== null);

console.log(`${books.length} couvertures externes à rapatrier${dryRun ? " (dry-run)" : ""}`);
if (dryRun) {
  const byHost: Record<string, number> = {};
  for (const book of books) byHost[hostOf(book.cover_url)] = (byHost[hostOf(book.cover_url)] ?? 0) + 1;
  console.log(JSON.stringify(byHost, null, 1));
}

let internalized = 0;
let skipped = 0;
/** Les échecs par famille puis par hôte (#272) — la sortie du run en dépend. */
const failures: Record<CoverFailureKind, Record<string, number>> = { corpse: {}, network: {}, infra: {} };
const countFailures = (byHost: Record<string, number>) => Object.values(byHost).reduce((sum, count) => sum + count, 0);

for (const book of dryRun ? [] : books) {
  await sleep(POLITENESS_DELAY_MS);
  const host = hostOf(book.cover_url);
  try {
    // La même frontière que l'app (garde SSRF + hôtes en lien direct) : hôte
    // rapatriable ou rien.
    if (!isInternalizableCoverUrl(book.cover_url)) {
      skipped++;
      continue;
    }
    // Pas de réponse HTTP (DNS, connexion, timeout) = réseau ; une réponse qui
    // n'est pas une image exploitable = cadavre (voir covers-run-verdict.mts).
    let response: Response;
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
    let source: Buffer;
    try {
      source = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      // Connexion coupée en plein corps : pas de réponse complète = réseau.
      throw new CoverFailure("network", error instanceof Error ? error.message : String(error));
    }
    if (source.length === 0 || source.length > MAX_SOURCE_BYTES) throw new CoverFailure("corpse", `taille ${source.length}`);

    let webp: Buffer;
    try {
      webp = await sharp(source)
        .resize(INTERNALIZED_COVER_MAX_DIMENSION, INTERNALIZED_COVER_MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();
    } catch (error) {
      // Un fichier que sharp ne lit pas est un cadavre (placeholder, HTML
      // déguisé) — pas une panne de notre côté.
      throw new CoverFailure("corpse", `illisible : ${error instanceof Error ? error.message : String(error)}`);
    }

    const path = `${book.user_id}/cover-${book.id}.webp`;
    // cacheControl 1 an : le CONTENU d'un chemin ne change qu'avec un `?v=`
    // sur l'URL (ci-dessous) — chaque re-téléchargement horaire était de
    // l'egress perdu.
    const { error: uploadError } = await admin.storage
      .from(COVERS_BUCKET)
      .upload(path, webp, { contentType: "image/webp", upsert: true, cacheControl: "31536000" });
    if (uploadError) throw new CoverFailure("infra", `upload : ${uploadError.message}`);

    // Optimiste : on ne bascule que si la couverture n'a pas changé entre-temps
    // (photo posée, choix, réparation #53…) — le perdant laisse juste un
    // fichier que la purge mensuelle (#205) ramassera.
    // `?v=` (#276) : chemin déterministe + cache d'un an — une couverture
    // CHOISIE à nouveau sur un livre déjà rapatrié serait invisible sans
    // version d'URL. La purge retire la query avant de comparer.
    const internalUrl = `${internalPrefix}${path}?v=${Date.now()}`;
    const { error: updateError, count } = await admin
      .from("books")
      .update({ cover_url: internalUrl }, { count: "exact" })
      .eq("id", book.id)
      .eq("cover_url", book.cover_url);
    if (updateError) throw new CoverFailure("infra", `update : ${updateError.message}`);
    // Le compteur dit ce qui a VRAIMENT basculé (#275) : la course perdue
    // laisse un fichier à la purge, pas un +1.
    if (count === 1) internalized++;
    else skipped++;
  } catch (error) {
    const kind = classifyFailure(error);
    failures[kind][host] = (failures[kind][host] ?? 0) + 1;
    console.error(` - ${kind} ${host} (livre ${book.id.slice(0, 8)}…) : ${error instanceof Error ? error.message : String(error)}`);
  }
}

const counts = {
  internalized,
  corpse: countFailures(failures.corpse),
  network: countFailures(failures.network),
  infra: countFailures(failures.infra),
};
if (!dryRun) {
  console.log(
    `${internalized} rapatriées, ${skipped} sautées (hôte non rapatriable ou course perdue) — cadavres ${JSON.stringify(failures.corpse)}, ` +
      `réseau ${JSON.stringify(failures.network)}, infra ${JSON.stringify(failures.infra)}`,
  );
}
// Les cadavres sont NORMAUX (liens morts — la réparation #53 les traite, on
// retente demain) : le run n'est rouge que sur panne d'infra ou réseau totale
// (#272, verdict pur et testé dans covers-run-verdict.mts).
if (shouldFailRun(counts)) {
  console.error(counts.infra > 0 ? "Panne d'infra (bucket ou base) — voir les échecs ci-dessus." : "Panne réseau totale : aucune réponse HTTP reçue.");
  process.exit(1);
}
console.log("Rapatriement terminé.");
