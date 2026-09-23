/**
 * Génère les VIGNETTES des fonds de thème de la carte de partage (§4.15).
 * Source : public/share/themes/theme_N.webp (1024×1536, 45 à 385 Ko chacun —
 * calibrés au pixel dans le labo docs/protos/proto-share-cards.html, jamais
 * modifiés ici). Sortie : theme_N-thumb.webp, 128 px de large (2× la vignette
 * 64×96 CSS du sélecteur), quelques Ko.
 *
 * Fluidité #331 (item 9) : le sélecteur de thème affichait les fonds pleine
 * taille dans des <img> de 64×96 — 2,29 Mo pour dix vignettes. Le fond
 * pleine taille n'est chargé que par le rendu canvas du thème choisi.
 *
 * Régénérable : `node scripts/gen-share-thumbs.mjs` (à relancer si un fond
 * est recalibré). Les vignettes sont committées comme les fonds.
 */

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const THUMBNAIL_WIDTH = 128;
const THUMBNAIL_QUALITY = 75;
const THUMBNAIL_SUFFIX = "-thumb";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const themesDirectory = join(projectRoot, "public", "share", "themes");

const backgrounds = readdirSync(themesDirectory).filter(
  (file) => file.endsWith(".webp") && !file.endsWith(`${THUMBNAIL_SUFFIX}.webp`),
);

for (const file of backgrounds) {
  const source = join(themesDirectory, file);
  const destination = join(themesDirectory, file.replace(/\.webp$/, `${THUMBNAIL_SUFFIX}.webp`));
  const { size } = await sharp(source).resize({ width: THUMBNAIL_WIDTH }).webp({ quality: THUMBNAIL_QUALITY }).toFile(destination);
  console.log(`[gen-share-thumbs] ${file} → ${destination.split(/[\\/]/).pop()} (${Math.round(size / 1024)} Ko)`);
}
