/**
 * Télécharge le dernier dump de la Grand Comics Database.
 *
 * Le téléchargement exige d'être connecté à comics.org (compte gratuit) : on rejoue donc
 * le cookie de session d'un navigateur déjà authentifié.
 *
 * Comment récupérer le cookie, une fois :
 *   1. Se connecter sur https://www.comics.org
 *   2. DevTools → Application → Cookies → copier la valeur de `sessionid`
 *   3. La mettre dans .env.local :  GCD_SESSION_COOKIE=sessionid=xxxxxxxx
 *
 * Usage :
 *   node scripts/gcd-download.mjs
 *
 * Le script ne devine PAS le nom du fichier : il lit la page de téléchargement et y cherche
 * le lien du .zip. Il continue donc de marcher si GCD renomme son dump.
 *
 * ⚠️ Non testé contre le vrai site (il faut un compte). Si ça casse, l'erreur affichée
 * indique quelle étape a échoué — connexion, lien introuvable, ou téléchargement.
 */

import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const DOWNLOAD_PAGE = "https://www.comics.org/download/";
const OUTPUT_DIRECTORY = "C:/Users/premg/Downloads/gcd";

const sessionCookie = process.env.GCD_SESSION_COOKIE;
if (!sessionCookie) {
  console.error("Il manque GCD_SESSION_COOKIE (cf. l'en-tête de ce fichier).");
  process.exit(1);
}

// Cloudflare filtre les clients trop robotiques : on se présente comme un navigateur.
const headers = {
  Cookie: sessionCookie,
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
};

console.log("Lecture de la page de téléchargement…");
const page = await fetch(DOWNLOAD_PAGE, { headers });

if (page.status === 403) {
  console.error("403 — Cloudflare a bloqué la requête, ou le cookie n'est plus valide.");
  process.exit(1);
}
if (!page.ok) {
  console.error(`La page a répondu ${page.status}.`);
  process.exit(1);
}

const html = await page.text();

// On cherche le lien du dump sans présumer de son nom : GCD le renomme régulièrement.
const zipLink = html.match(/href="([^"]+\.zip)"/i)?.[1];
if (!zipLink) {
  console.error(
    "Aucun lien .zip trouvé sur la page. Soit le cookie a expiré (on voit la page de login), " +
      "soit GCD a changé sa mise en page — ouvre la page dans un navigateur pour vérifier.",
  );
  process.exit(1);
}

const zipUrl = new URL(zipLink, DOWNLOAD_PAGE).href;
console.log(`Dump trouvé : ${zipUrl}`);

const archive = await fetch(zipUrl, { headers });
if (!archive.ok) {
  console.error(`Le téléchargement a répondu ${archive.status}.`);
  process.exit(1);
}

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
const target = `${OUTPUT_DIRECTORY}/${zipUrl.split("/").pop()}`;

const totalBytes = Number(archive.headers.get("content-length") ?? 0);
let downloadedBytes = 0;

const progress = new TransformStream({
  transform(chunk, controller) {
    downloadedBytes += chunk.length;
    if (totalBytes) {
      const percent = ((downloadedBytes / totalBytes) * 100).toFixed(0);
      process.stdout.write(`\r  ${percent} % (${(downloadedBytes / 1e6).toFixed(0)} Mo)`);
    }
    controller.enqueue(chunk);
  },
});

await pipeline(
  Readable.fromWeb(archive.body.pipeThrough(progress)),
  createWriteStream(target),
);

console.log(`\n\nDump téléchargé : ${target}`);
console.log("\nÉtapes suivantes :");
console.log("  1. Dézipper l'archive");
console.log(`  2. node scripts/gcd-export.mjs "<le .sql extrait>"`);
console.log("  3. Recharger les CSV dans Supabase");
