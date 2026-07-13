/**
 * Mesure ce que Metron sait rendre sur un échantillon réel de l'étagère.
 *
 * ATTENTION — le rôle de Metron a changé : il n'identifie PLUS les bouquins (c'est GCD
 * qui le fait, importé chez nous, cf. docs/product-specs.md §5). Metron ne sert plus
 * qu'à ENRICHIR : la couverture et le `series_type`.
 *
 * Ce script sert donc à savoir combien de tes comics Metron sait habiller — pas à
 * décider d'une source. Si le taux est faible, ce n'est pas grave : l'app bascule sur
 * la photo de la couverture, prise au moment du scan.
 *
 * Usage :
 *   1. Créer un compte gratuit sur https://metron.cloud
 *   2. METRON_USERNAME=... METRON_PASSWORD=... node scripts/metron-coverage.mjs
 *
 * L'échantillon se remplit dans scripts/shelf-sample.txt, une entrée par ligne :
 *   - un code-barres (UPC complet avec supplément, ou 12 chiffres) : 75960609558200111
 *   - ou "Série|numéro" quand on n'a pas le code sous la main :     Saga|60
 * Les lignes vides et celles commençant par # sont ignorées.
 */

import { readFile } from "node:fs/promises";

const API_BASE = "https://metron.cloud/api";
const SAMPLE_FILE = new URL("./shelf-sample.txt", import.meta.url);

// Metron throttle à 20 requêtes/minute : on s'y tient largement.
const DELAY_BETWEEN_REQUESTS_MS = 3_500;

const username = process.env.METRON_USERNAME;
const password = process.env.METRON_PASSWORD;

if (!username || !password) {
  console.error("Il manque METRON_USERNAME et METRON_PASSWORD dans l'environnement.");
  process.exit(1);
}

const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

/** Interroge Metron et renvoie le premier résultat, ou null. */
async function queryMetron(searchParams) {
  const response = await fetch(`${API_BASE}/issue/?${searchParams}`, {
    headers: { Authorization: authorization, Accept: "application/json" },
  });

  if (response.status === 429) throw new Error("Throttle Metron atteint (429)");
  if (!response.ok) throw new Error(`Metron a répondu ${response.status}`);

  const { results } = await response.json();
  return results?.[0] ?? null;
}

/** Une entrée de l'échantillon → une tentative de résolution. */
async function resolve(entry) {
  const isBarcode = /^\d+$/.test(entry);

  if (isBarcode) {
    // Tentative 1 : le code-barres complet (UPC + supplément) — le seul match exact possible.
    const exact = await queryMetron(new URLSearchParams({ upc: entry }));
    if (exact) return { found: exact, via: "upc" };

    // Tentative 2 : sans le supplément. Metron ne fait que du match exact, donc ça n'aboutira
    // que si l'UPC stocké chez eux est lui aussi sur 12 chiffres. C'est précisément la limite
    // que le dump GCD lèverait (recherche par préfixe).
    if (entry.length > 12) {
      await sleep(DELAY_BETWEEN_REQUESTS_MS);
      const withoutSupplement = await queryMetron(new URLSearchParams({ upc: entry.slice(0, 12) }));
      if (withoutSupplement) return { found: withoutSupplement, via: "upc-12" };
    }

    return { found: null, via: null };
  }

  const [seriesName, number] = entry.split("|").map((part) => part.trim());
  const bySeries = await queryMetron(
    new URLSearchParams({ series_name: seriesName, ...(number ? { number } : {}) }),
  );
  return { found: bySeries, via: bySeries ? "series+number" : null };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sample = (await readFile(SAMPLE_FILE, "utf8"))
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));

if (sample.length === 0) {
  console.error("scripts/shelf-sample.txt est vide — ajoute tes comics, un par ligne.");
  process.exit(1);
}

console.log(`Test de couverture Metron sur ${sample.length} entrées.\n`);

const results = [];

for (const [index, entry] of sample.entries()) {
  if (index > 0) await sleep(DELAY_BETWEEN_REQUESTS_MS);

  try {
    const { found, via } = await resolve(entry);

    if (found) {
      // series.series_type nous donne directement la catégorie du barème (Single Issue,
      // Trade Paperback, Omnibus…) — c'est tout l'intérêt de Metron.
      const seriesType = found.series?.series_type?.name ?? "?";
      console.log(`  OK   ${entry}\n       → ${found.issue ?? found.series?.name} [${seriesType}] (via ${via})`);
      results.push({ entry, found: true, seriesType });
    } else {
      console.log(`  RATÉ ${entry}`);
      results.push({ entry, found: false });
    }
  } catch (error) {
    console.log(`  ERR  ${entry} — ${error.message}`);
    results.push({ entry, found: false, error: error.message });
  }
}

const hits = results.filter((result) => result.found).length;
const rate = Math.round((hits / results.length) * 100);

console.log(`\n─────────────────────────────────`);
console.log(`Taux de réussite : ${hits}/${results.length} (${rate} %)`);
console.log(`Ratés : ${results.filter((r) => !r.found).map((r) => r.entry).join(", ") || "aucun"}`);
console.log(`\nSi les ratés sont surtout de l'indé → on passe au dump GCD (cf. specs).`);
