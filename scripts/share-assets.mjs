// Assets de la carte de partage (§4.15, issue #263).
//
// 1) POLICES : télécharge en woff2 (sous-ensemble latin) les familles Google
//    Fonts identifiées par thème sur les planches-spécimens du proto.
//    AUTO-HÉBERGÉES dans public/share/fonts/ — jamais de hotlink Google en
//    prod (RGPD : la CJUE considère la transmission d'IP à Google comme un
//    transfert de donnée personnelle). Licences : SIL OFL pour toutes.
// 2) FONDS : recompresse les fonds vierges (docs/protos/templates/, 2-3,5 Mo
//    en JPEG) vers public/share/themes/ en WebP (~150-300 Ko), dimensions
//    1024×1536 inchangées — le fichier de coordonnées en dépend.
//
// À relancer à chaque nouveau thème ou nouvelle police, puis committer les
// sorties (public/ est servi statique). Fond modifié en place → bumper
// SHARE_BACKGROUND_VERSION (lib/share/themes.ts) : le cache HTTP garde sinon
// l'ancien fond jusqu'à 37 jours (review #352).
import { mkdirSync, writeFileSync } from "node:fs";
import pkg from "../package.json" with { type: "json" };
import sharp from "sharp";

void pkg; // (import racine : garde le script ancré au projet)

const FONTS = [
  { family: "Abhaya Libre", weights: [400] },
  { family: "Alegreya", weights: [900] },
  { family: "Aleo", weights: [900] },
  { family: "Alfa Slab One", weights: [400] },
  { family: "Amaranth", italics: [700] },
  { family: "Anybody", weights: [600] },
  { family: "Asap Condensed", weights: [700] },
  { family: "Barlow", italics: [800] },
  { family: "Barlow Condensed", weights: [800], italics: [800, 900] },
  { family: "Bebas Neue", weights: [400] },
  { family: "Big Shoulders Stencil", weights: [900] },
  { family: "Caudex", weights: [700] },
  { family: "Cormorant Garamond", weights: [700] },
  { family: "Courier Prime", weights: [400] },
  { family: "EB Garamond", weights: [500, 600, 800] },
  { family: "Exo 2", weights: [900], italics: [800] },
  { family: "Finlandica Headline", italics: [900] },
  { family: "Gentium Plus", weights: [400] },
  { family: "Heebo", weights: [600, 800] },
  { family: "Knewave", weights: [400] },
  { family: "Libre Caslon Text", weights: [400] },
  { family: "Literata", weights: [700, 800] },
  { family: "Lora", weights: [700] },
  { family: "Mona Sans", weights: [800] },
  { family: "New Rocker", weights: [400] },
  { family: "Noto Sans", italics: [800] },
  { family: "Oswald", weights: [500, 600] },
  { family: "Rajdhani", weights: [700] },
  { family: "Roboto", weights: [700, 900] },
  { family: "Roboto Condensed", weights: [900] },
  { family: "Roboto Slab", weights: [700] },
  { family: "Saira Condensed", weights: [700, 800] },
  { family: "Saira Extra Condensed", weights: [800] },
  { family: "Sofia Sans Extra Condensed", italics: [900] },
  { family: "Special Elite", weights: [400] },
  { family: "Tomorrow", weights: [700], italics: [700] },
];

const slugify = (family) => family.toLowerCase().replace(/\s+/g, "-");
// Un UA moderne : l'API css2 ne sert le woff2 qu'aux navigateurs qui le gèrent.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function fetchLatinWoff2(family, weight, italic) {
  const spec = italic ? `ital,wght@1,${weight}` : `wght@${weight}`;
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:${spec}&display=swap`;
  const css = await (await fetch(url, { headers: { "User-Agent": UA } })).text();
  // Le bloc du sous-ensemble latin (le dernier /* latin */ du fichier).
  const blocks = css.split("/* ");
  const latin = blocks.find((block) => block.startsWith("latin */"));
  const match = (latin ?? css).match(/url\((https:[^)]+\.woff2)\)/);
  if (!match) throw new Error(`woff2 latin introuvable pour ${family} ${weight}${italic ? " italic" : ""}`);
  const buffer = Buffer.from(await (await fetch(match[1])).arrayBuffer());
  const name = `${slugify(family)}-${weight}${italic ? "-italic" : ""}.woff2`;
  writeFileSync(new URL(`../public/share/fonts/${name}`, import.meta.url), buffer);
  console.log(`  ${name} (${(buffer.length / 1024).toFixed(0)} Ko)`);
}

mkdirSync(new URL("../public/share/fonts/", import.meta.url), { recursive: true });
mkdirSync(new URL("../public/share/themes/", import.meta.url), { recursive: true });

console.log("Polices :");
for (const font of FONTS) {
  for (const weight of font.weights ?? []) await fetchLatinWoff2(font.family, weight, false);
  for (const weight of font.italics ?? []) await fetchLatinWoff2(font.family, weight, true);
}

console.log("Fonds :");
for (let i = 0; i <= 10; i++) {
  const source = new URL(`../docs/protos/templates/theme_${i}_virgin.jpeg`, import.meta.url);
  const target = new URL(`../public/share/themes/theme_${i}.webp`, import.meta.url);
  const buffer = await sharp(source.pathname.replace(/^\/(?=[A-Za-z]:)/, "")).webp({ quality: 80, effort: 6 }).toBuffer();
  writeFileSync(target, buffer);
  console.log(`  theme_${i}.webp (${(buffer.length / 1024).toFixed(0)} Ko)`);
}
console.log("OK");
