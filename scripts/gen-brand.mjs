/**
 * Génère les assets de marque Objectif PAL à partir du logo HD de l'émission.
 * Source : public/brand/logo-hd.jpg (1280×720, fond blanc — reçu de Léna le
 * 13/08/2026, issue #87). L'ancienne affiche public/brand/objectif-PAL.jpg reste
 * la référence du fond de marque #2e2357.
 * Régénérable : `node scripts/gen-brand.mjs`.
 *
 * Le logo n'est pas détouré (fond blanc, JPEG) et contient du blanc *à
 * l'intérieur* (les lettres « OBJECTIF ») : on détoure donc par remplissage
 * depuis les bords, pas par suppression globale du blanc. L'emblème (la pile de
 * livres) et le titre s'interpénètrent autour de x≈660, donc pas de recadrage
 * rectangulaire possible : on sépare par composantes connexes — chaque forme
 * du titre démarre à droite de TEXT_XMIN, chaque rayon de l'emblème part de
 * bien plus à gauche. Seule soudure dans le dessin : la pointe du rayon bleu
 * est collée au contour noir du « O » — une coupe diagonale dans le noir
 * fusionné (CUT_A→CUT_B, invisible : noir des deux côtés) sépare les deux,
 * appliquée uniquement à l'extraction de l'emblème, jamais au logo complet.
 *
 * Sorties :
 *  - public/icons/icon-{192,512}.png + icon-maskable-512.png (emblème seul, sur
 *    fond #2e2357 — l'icône installée « sans titre », carrée PAS ronde)
 *  - app/favicon.ico (emblème 48px)
 *  - public/brand/logo-full.webp (emblème + « OBJECTIF PAL » sur #2e2357 — la
 *    splash « avec titre », consommée par components/splash-screen.tsx)
 *  - public/brand/logo-mark.png  (emblème seul, fond transparent — réserve)
 */
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const SRC = "public/brand/logo-hd.jpg";
export const BRAND_BG = "#2e2357"; // le fond de l'affiche, échantillonné

const WHITE_MIN = 232; // en-deçà sur un canal → pixel considéré comme du dessin
const HALO_MIN = 205; // pixels de bord quasi blancs rongés après le remplissage
const TEXT_XMIN = 640; // une composante qui démarre à droite → forme du titre (le « O » démarre à x≈645)
const SPECK_MAX = 10; // composantes plus petites → poussières JPEG, supprimées
const CUT_A = { x: 670, y: 260 }; // coupe rayon bleu / « O », mesurée sur le HD
const CUT_B = { x: 650, y: 300 };

const { data, info } = await sharp(SRC)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const { width, height } = info;
const CH = 4;

const isWhite = (i) =>
  data[i] >= WHITE_MIN && data[i + 1] >= WHITE_MIN && data[i + 2] >= WHITE_MIN;
const isNearWhite = (i) =>
  data[i] >= HALO_MIN && data[i + 1] >= HALO_MIN && data[i + 2] >= HALO_MIN;

// --- 1. Détourage : remplissage du blanc depuis les bords (BFS 4-connexe). ---
const stack = [];
const clear = (x, y) => {
  const i = (y * width + x) * CH;
  if (data[i + 3] === 0 || !isWhite(i)) return;
  data[i + 3] = 0;
  stack.push(x, y);
};
for (let x = 0; x < width; x++) {
  clear(x, 0);
  clear(x, height - 1);
}
for (let y = 0; y < height; y++) {
  clear(0, y);
  clear(width - 1, y);
}
while (stack.length) {
  const y = stack.pop();
  const x = stack.pop();
  if (x > 0) clear(x - 1, y);
  if (x < width - 1) clear(x + 1, y);
  if (y > 0) clear(x, y - 1);
  if (y < height - 1) clear(x, y + 1);
}

// --- 2. Anti-halo : ronger les pixels de bord quasi blancs (artefacts JPEG). ---
for (let pass = 0; pass < 2; pass++) {
  const toClear = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * CH;
      if (data[i + 3] === 0 || !isNearWhite(i)) continue;
      const nextToClear =
        (x > 0 && data[i - CH + 3] === 0) ||
        (x < width - 1 && data[i + CH + 3] === 0) ||
        (y > 0 && data[i - width * CH + 3] === 0) ||
        (y < height - 1 && data[i + width * CH + 3] === 0);
      if (nextToClear) toClear.push(i);
    }
  }
  for (const i of toClear) data[i + 3] = 0;
}

// --- 2 bis. Décontamination : le périmètre du dessin est partout un contour
// noir ; les pixels de bord encore clairs (mélange anti-aliasé vers l'ancien
// fond blanc) sont tirés vers le pixel le plus sombre du voisinage 5×5, d'autant
// plus fort qu'ils sont clairs. Tue le liseré gris sur fond sombre. ---
{
  const nearTransparent = (x, y) => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return true;
        if (data[(ny * width + nx) * CH + 3] === 0) return true;
      }
    }
    return false;
  };
  const fixes = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * CH;
      if (data[i + 3] === 0) continue;
      const mean = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (mean <= 90 || !nearTransparent(x, y)) continue;
      let darkest = i;
      let darkestMean = mean;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = (ny * width + nx) * CH;
          if (data[ni + 3] === 0) continue;
          const nm = (data[ni] + data[ni + 1] + data[ni + 2]) / 3;
          if (nm < darkestMean) {
            darkestMean = nm;
            darkest = ni;
          }
        }
      }
      const t = (mean - 90) / (255 - 90);
      fixes.push([i, darkest, t]);
    }
  }
  // Appliqué après coup pour que la passe lise des couleurs non modifiées.
  for (const [i, d, t] of fixes) {
    for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] + (data[d + c] - data[i + c]) * t);
  }
}

// --- 3. Composantes connexes : séparer l'emblème des formes du titre. ---
// La coupe rayon/« O » vit dans une copie : le logo complet garde la soudure.
const cutData = Buffer.from(data);
{
  const steps = Math.max(Math.abs(CUT_B.x - CUT_A.x), Math.abs(CUT_B.y - CUT_A.y));
  for (let s = 0; s <= steps; s++) {
    const x = Math.round(CUT_A.x + ((CUT_B.x - CUT_A.x) * s) / steps);
    const y = Math.round(CUT_A.y + ((CUT_B.y - CUT_A.y) * s) / steps);
    for (let dx = -1; dx <= 1; dx++) cutData[(y * width + x + dx) * CH + 3] = 0;
  }
}
const label = new Int32Array(width * height); // 0 = fond, sinon id de composante
const boxes = []; // par id-1 : { xmin, xmax, ymin, ymax, px }
let nextId = 0;
for (let sy = 0; sy < height; sy++) {
  for (let sx = 0; sx < width; sx++) {
    const sp = sy * width + sx;
    if (label[sp] !== 0 || cutData[sp * CH + 3] === 0) continue;
    const id = ++nextId;
    const box = { xmin: sx, xmax: sx, ymin: sy, ymax: sy, px: 0 };
    boxes.push(box);
    const st = [sx, sy];
    label[sp] = id;
    while (st.length) {
      const y = st.pop();
      const x = st.pop();
      box.px++;
      if (x < box.xmin) box.xmin = x;
      if (x > box.xmax) box.xmax = x;
      if (y < box.ymin) box.ymin = y;
      if (y > box.ymax) box.ymax = y;
      const visit = (nx, ny) => {
        const p = ny * width + nx;
        if (label[p] === 0 && cutData[p * CH + 3] !== 0) {
          label[p] = id;
          st.push(nx, ny);
        }
      };
      if (x > 0) visit(x - 1, y);
      if (x < width - 1) visit(x + 1, y);
      if (y > 0) visit(x, y - 1);
      if (y < height - 1) visit(x, y + 1);
    }
  }
}
const isSpeck = boxes.map((b) => b.px < SPECK_MAX);
const isTextComponent = boxes.map((b, i) => !isSpeck[i] && b.xmin >= TEXT_XMIN);

// Garde-fou : les seuils (TEXT_XMIN, CUT_A/CUT_B…) sont mesurés sur CE fichier.
// Une nouvelle source doit faire échouer le script bruyamment plutôt que de
// produire en silence un emblème qui embarque des lettres du titre.
const textCount = isTextComponent.filter(Boolean).length;
if (textCount !== 4) {
  throw new Error(
    `${textCount} formes de titre détectées (4 attendues : OBJECTIF, PA, L, F) — ` +
      `la source a changé ? Re-mesurer TEXT_XMIN et CUT_A/CUT_B (voir l'en-tête).`,
  );
}

// Logo complet = original moins les poussières ; emblème = cutData mutée en
// place (elle ne ressert plus ensuite) moins poussières et formes du titre (la
// pointe orpheline du rayon coupé, à droite de la coupe, est classée titre par
// sa position et disparaît aussi).
const markData = cutData;
for (let p = 0; p < width * height; p++) {
  if (label[p] === 0) continue;
  const idx = label[p] - 1;
  if (isSpeck[idx]) {
    data[p * CH + 3] = 0;
    markData[p * CH + 3] = 0;
  } else if (isTextComponent[idx]) {
    markData[p * CH + 3] = 0;
  }
}

// Boîtes englobantes serrées (logo complet / emblème seul).
const bbox = (predicate) => {
  const b = { xmin: width, xmax: -1, ymin: height, ymax: -1 };
  boxes.forEach((box, idx) => {
    if (isSpeck[idx] || !predicate(idx)) return;
    if (box.xmin < b.xmin) b.xmin = box.xmin;
    if (box.xmax > b.xmax) b.xmax = box.xmax;
    if (box.ymin < b.ymin) b.ymin = box.ymin;
    if (box.ymax > b.ymax) b.ymax = box.ymax;
  });
  return { left: b.xmin, top: b.ymin, width: b.xmax - b.xmin + 1, height: b.ymax - b.ymin + 1 };
};
const fullBox = bbox(() => true);
const markBox = bbox((idx) => !isTextComponent[idx]);
// Même filet : l'emblème ne s'étend jamais dans la zone du titre.
if (markBox.left + markBox.width > 750) {
  throw new Error(
    `L'emblème s'étend jusqu'à x=${markBox.left + markBox.width} (>750, dans la zone du titre) — ` +
      `classification à revoir pour cette source.`,
  );
}
console.log(
  `${nextId} composantes : ${isSpeck.filter(Boolean).length} poussières, ` +
    `${isTextComponent.filter(Boolean).length} titre, ` +
    `${boxes.filter((_, i) => !isSpeck[i] && !isTextComponent[i]).length} emblème`,
);
console.log("logo complet :", JSON.stringify(fullBox), "— emblème :", JSON.stringify(markBox));

const raw = { raw: { width, height, channels: CH } };
const fullCut = await sharp(data, raw).extract(fullBox).png().toBuffer();
const markCut = await sharp(markData, raw).extract(markBox).png().toBuffer();

/**
 * Emblème posé au centre d'un carré de fond #2e2357.
 * Palette 256 couleurs par défaut (le style cartoon s'y prête, ÷5 sur le
 * poids) — SAUF pour le favicon : Turbopack décode app/favicon.ico au build
 * (route metadata) et exige un PNG embarqué en RGBA, un PNG8 indexé casse le
 * build (« The PNG is not in RGBA format! »).
 */
async function icon(size, innerRatio, { palette = true } = {}) {
  const inner = Math.round(size * innerRatio);
  const embl = await sharp(markCut)
    .resize(inner, inner, { fit: "contain", background: "#00000000", kernel: "lanczos3" })
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: BRAND_BG } })
    .composite([{ input: embl, gravity: "center" }])
    .png(palette ? { palette: true, quality: 100, compressionLevel: 9 } : { compressionLevel: 9 });
}

// Icônes installées (carrées — PAS rondes, décision utilisateur).
await (await icon(192, 0.78)).toFile("public/icons/icon-192.png");
await (await icon(512, 0.78)).toFile("public/icons/icon-512.png");
// Maskable : emblème plus petit (zone de sécurité ~80 %), fond plein cadre.
await (await icon(512, 0.62)).toFile("public/icons/icon-maskable-512.png");

// Favicon : PNG 48px emballé en .ico (PNG-in-ICO, supporté partout).
// RGBA obligatoire — voir le commentaire de icon().
const favPng = await (await icon(48, 0.84, { palette: false })).toBuffer();
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

// Splash : logo complet aplati sur le fond de marque, ×2 de la taille affichée
// max (460px) pour les écrans denses. Composite puis resize en deux étapes :
// sharp redimensionne la base AVANT de composer, il faut donc matérialiser.
const splashFlat = await sharp({
  create: { width: fullBox.width + 80, height: fullBox.height + 80, channels: 4, background: BRAND_BG },
})
  .composite([{ input: fullCut, gravity: "center" }])
  .flatten({ background: BRAND_BG })
  .png()
  .toBuffer();
await sharp(splashFlat)
  .resize({ width: 920, kernel: "lanczos3" })
  .webp({ quality: 92 })
  .toFile("public/brand/logo-full.webp");

// Réserve : emblème seul détouré, fond transparent.
await sharp(markCut)
  .resize({ width: 512, kernel: "lanczos3" })
  .png({ palette: true, quality: 100, compressionLevel: 9 })
  .toFile("public/brand/logo-mark.png");

console.log("Assets de marque générés (fond", BRAND_BG + ").");
