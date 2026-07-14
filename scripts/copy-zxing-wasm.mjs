// Copie le binaire WASM du scanner depuis node_modules vers public/wasm/,
// pour le servir NOUS-MÊMES au lieu de dépendre du CDN jsDelivr (qui peut
// être bloqué — et l'échec serait silencieux : caméra muette, zéro scan).
//
// Lancé par le hook `postinstall` (donc aussi sur Vercel à chaque build).
// public/wasm/ est gitignoré : le fichier se régénère à chaque install.
//
// ⚠️ Le binaire doit correspondre EXACTEMENT à la version du paquet zxing-wasm
// (cf. son README) — c'est garanti ici puisqu'on copie depuis node_modules.

import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(projectRoot, "node_modules", "zxing-wasm", "dist", "reader", "zxing_reader.wasm");
const destinationDirectory = join(projectRoot, "public", "wasm");
const destination = join(destinationDirectory, "zxing_reader.wasm");

mkdirSync(destinationDirectory, { recursive: true });
copyFileSync(source, destination);
console.log(`[copy-zxing-wasm] ${source} → ${destination}`);
