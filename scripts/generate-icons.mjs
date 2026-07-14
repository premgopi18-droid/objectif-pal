/**
 * Génère les icônes PWA — trois dos de livres sur fond sombre, en pur
 * géométrique (aucun outil graphique requis, rejouable à volonté).
 *
 * Usage : node scripts/generate-icons.mjs
 * Produit : public/icons/icon-192.png, icon-512.png, icon-maskable-512.png
 */

import { mkdirSync, createWriteStream } from "node:fs";
import { PNG } from "pngjs";

const BACKGROUND = { red: 10, green: 10, blue: 10 }; // le #0a0a0a du thème
const AMBER = { red: 245, green: 158, blue: 11 }; // l'accent de l'app
const RED = { red: 239, green: 68, blue: 68 };
const SKY = { red: 56, green: 189, blue: 248 };

/**
 * Dessine trois dos de livres appuyés sur une ligne de sol.
 * `safeZoneRatio` : fraction du canevas occupée par le motif (les icônes
 * maskable exigent que tout tienne dans le cercle central de 80 %).
 */
function drawIcon(size, safeZoneRatio) {
  const png = new PNG({ width: size, height: size });

  const setPixel = (x, y, color) => {
    const index = (size * y + x) * 4;
    png.data[index] = color.red;
    png.data[index + 1] = color.green;
    png.data[index + 2] = color.blue;
    png.data[index + 3] = 255;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) setPixel(x, y, BACKGROUND);
  }

  const zone = size * safeZoneRatio;
  const margin = (size - zone) / 2;
  const floor = Math.round(margin + zone * 0.85);
  const spineWidth = Math.round(zone * 0.17);
  const gap = Math.round(zone * 0.06);

  // [couleur, hauteur relative, inclinaison] — le 3ᵉ livre penche, comme sur une étagère.
  const spines = [
    { color: AMBER, height: 0.62, lean: 0 },
    { color: RED, height: 0.72, lean: 0 },
    { color: SKY, height: 0.55, lean: 0.18 },
  ];

  let cursorX = Math.round(margin + zone * 0.16);
  for (const spine of spines) {
    const spineHeight = Math.round(zone * spine.height);
    for (let y = 0; y < spineHeight; y += 1) {
      // Penché : le haut du livre glisse vers la droite proportionnellement.
      const offset = Math.round(spine.lean * (spineHeight - y));
      for (let x = 0; x < spineWidth; x += 1) {
        const pixelX = cursorX + x + offset;
        const pixelY = floor - y;
        if (pixelX >= 0 && pixelX < size && pixelY >= 0 && pixelY < size) {
          setPixel(pixelX, pixelY, spine.color);
        }
      }
    }
    cursorX += spineWidth + gap;
  }

  return png;
}

function writePng(png, path) {
  return new Promise((resolve, reject) => {
    png.pack().pipe(createWriteStream(path)).on("finish", resolve).on("error", reject);
  });
}

mkdirSync(new URL("../public/icons/", import.meta.url), { recursive: true });
const output = (name) => new URL(`../public/icons/${name}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

await writePng(drawIcon(192, 0.84), output("icon-192.png"));
await writePng(drawIcon(512, 0.84), output("icon-512.png"));
// Maskable : le motif tient dans la zone sûre (80 % central).
await writePng(drawIcon(512, 0.58), output("icon-maskable-512.png"));

console.log("Icônes générées dans public/icons/.");
