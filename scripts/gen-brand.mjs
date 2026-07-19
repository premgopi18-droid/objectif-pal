/**
 * Génère les assets de marque Objectif PAL à partir de l'affiche de l'émission.
 * Source : public/brand/objectif-PAL.jpg (l'affiche « Qui va gagner ? »).
 * Régénérable : `node scripts/gen-brand.mjs`. Si un jour un logo détouré haute
 * définition arrive, remplacer SRC et ajuster les boîtes de recadrage.
 *
 * Sorties :
 *  - public/icons/icon-{192,512}.png + icon-maskable-512.png (emblème seul, sur
 *    le fond de l'affiche — l'icône installée « sans titre »)
 *  - app/favicon.ico (emblème 48px)
 *  - public/brand/logo-full.png  (emblème + « OBJECTIF PAL » — la splash « avec titre »)
 *  - public/brand/logo-mark.png  (emblème seul, upscalé — la splash « sans titre »)
 *
 * La couleur de fond de l'affiche, mesurée : #2e2357 (uniforme derrière le logo).
 */
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const SRC = "public/brand/objectif-PAL.jpg";
export const BRAND_BG = "#2e2357"; // le fond de l'affiche, échantillonné

// Boîtes de recadrage dans l'affiche 660×440.
const FULL_CROP = { left: 398, top: 70, width: 250, height: 120 }; // emblème + wordmark
const MARK_CROP = { left: 398, top: 70, width: 120, height: 118 }; // emblème seul

const markCrop = await sharp(SRC).extract(MARK_CROP).toBuffer();
const fullCrop = await sharp(SRC).extract(FULL_CROP).toBuffer();

/** Emblème carré, upscalé proprement, posé au centre d'un carré de fond #2e2357. */
async function icon(size, innerRatio) {
  const inner = Math.round(size * innerRatio);
  const embl = await sharp(markCrop)
    .resize(inner, inner, { fit: "contain", background: BRAND_BG, kernel: "lanczos3" })
    .sharpen({ sigma: 0.6 })
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: BRAND_BG } })
    .composite([{ input: embl, gravity: "center" }])
    .png();
}

// Icônes installées (carrées — PAS rondes, décision utilisateur).
await (await icon(192, 0.78)).toFile("public/icons/icon-192.png");
await (await icon(512, 0.78)).toFile("public/icons/icon-512.png");
// Maskable : emblème plus petit (zone de sécurité ~80 %), fond plein cadre.
await (await icon(512, 0.62)).toFile("public/icons/icon-maskable-512.png");

// Favicon : PNG 48px emballé en .ico (PNG-in-ICO, supporté partout).
const favPng = await (await icon(48, 0.84)).toBuffer();
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2); // type = icône
header.writeUInt16LE(1, 4); // 1 image
const dir = Buffer.alloc(16);
dir.writeUInt8(48, 0); // largeur
dir.writeUInt8(48, 1); // hauteur
dir.writeUInt16LE(1, 4); // plans
dir.writeUInt16LE(32, 6); // bits/pixel
dir.writeUInt32LE(favPng.length, 8);
dir.writeUInt32LE(22, 12); // offset des données
writeFileSync("app/favicon.ico", Buffer.concat([header, dir, favPng]));

// Logos pour la splash (upscalés ×2,6, sur leur fond #2e2357 natif → sans couture).
await sharp(fullCrop).resize({ width: 650, kernel: "lanczos3" }).sharpen({ sigma: 0.6 }).png().toFile("public/brand/logo-full.png");
await sharp(markCrop).resize({ width: 312, kernel: "lanczos3" }).sharpen({ sigma: 0.6 }).png().toFile("public/brand/logo-mark.png");

console.log("Assets de marque générés (fond", BRAND_BG + ").");
