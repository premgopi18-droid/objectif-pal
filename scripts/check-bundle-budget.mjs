// Le budget de bundle (fluidité #331, item 13) — lu APRÈS `next build`, en CI
// comme en local (`node scripts/check-bundle-budget.mjs`).
//
// Le build Turbopack écrit `.next/diagnostics/route-bundle-stats.json` : pour
// chaque route, le JS du premier chargement (`firstLoadUncompressedJsBytes`,
// NON gzippé — la mesure qui bouge quand on ajoute une dépendance). Le socle
// commun a grossi jusqu'à 691 Ko sans que personne ne le voie (audit du
// 23/09/2026, epic #330) ; ce script transforme la dérive en échec de CI.
//
// Les plafonds sont posés à ~5 % au-dessus de la mesure du 23/09/2026 après
// l'allègement de Sentry (`compiler.define`, next.config.ts) : `/` à 809 Ko,
// `/login` à 931 Ko (il porte en plus le client Supabase navigateur). Les
// relever se fait ICI, dans une PR qui dit pourquoi — jamais en silence.

import { readFileSync } from "node:fs";

const STATS_PATH = ".next/diagnostics/route-bundle-stats.json";
const KILOBYTE = 1024;

/** Plafonds en octets, par route ; `DEFAULT_BUDGET_BYTES` pour toutes les autres. */
const ROUTE_BUDGET_BYTES = {
  "/login": 980 * KILOBYTE,
};
const DEFAULT_BUDGET_BYTES = 850 * KILOBYTE;

let stats;
try {
  stats = JSON.parse(readFileSync(STATS_PATH, "utf8"));
} catch (error) {
  console.error(
    `[bundle-budget] ${STATS_PATH} illisible : le build n'a pas produit les diagnostics Turbopack ` +
      "(en local, lancer `next build` d'abord ; en CI, vérifier la version de Next).",
    error.message,
  );
  process.exit(1);
}

// La forme du fichier est un DIAGNOSTIC de Turbopack, pas une API (review
// #340) : si un champ change de nom, `undefined > budget` serait `false` et
// le garde-fou se désarmerait en silence. On exige la forme attendue.
const isWellFormed =
  Array.isArray(stats) &&
  stats.length > 0 &&
  stats.every(
    (route) =>
      typeof route?.route === "string" &&
      typeof route.firstLoadUncompressedJsBytes === "number" &&
      Number.isFinite(route.firstLoadUncompressedJsBytes),
  );
if (!isWellFormed) {
  console.error(
    `[bundle-budget] ${STATS_PATH} n'a pas la forme attendue : un tableau non vide d'entrées ` +
      "{ route: string, firstLoadUncompressedJsBytes: number }. Adapter ce script à la nouvelle forme.",
  );
  process.exit(1);
}

const rows = stats
  .map((route) => {
    const budget = ROUTE_BUDGET_BYTES[route.route] ?? DEFAULT_BUDGET_BYTES;
    return { route: route.route, bytes: route.firstLoadUncompressedJsBytes, budget, over: route.firstLoadUncompressedJsBytes > budget };
  })
  .sort((left, right) => right.bytes - left.bytes);

const toKilobytes = (bytes) => `${Math.round(bytes / KILOBYTE)} Ko`;
for (const row of rows) {
  console.log(`${row.over ? "✗" : "✓"} ${row.route.padEnd(24)} ${toKilobytes(row.bytes).padStart(8)} / ${toKilobytes(row.budget)}`);
}

const breaches = rows.filter((row) => row.over);
if (breaches.length > 0) {
  console.error(
    `\n[bundle-budget] ${breaches.length} route(s) au-dessus du budget de premier chargement. ` +
      "Si la hausse est voulue, relever le plafond dans scripts/check-bundle-budget.mjs en expliquant pourquoi.",
  );
  process.exit(1);
}
console.log(`\n[bundle-budget] ${rows.length} routes sous budget.`);
