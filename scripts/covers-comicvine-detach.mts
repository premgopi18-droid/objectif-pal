/**
 * Le retrait de Comic Vine (#279, lot C) — l'autre moitié du « débranchable ».
 *
 * Retirer `COMIC_VINE_API_KEY` sur Vercel suffit à faire disparaître la source
 * de la feuille. Mais les couvertures déjà CHOISIES chez eux (lien direct,
 * jamais rapatriées) continueraient de s'afficher tant que leur CDN les sert.
 * Ce script les re-résout par les autres sources — Metron pour un UPC, la
 * chaîne ISBN sinon — et pose le résultat (ou rien : placeholder, la photo
 * reste), en vidant `cover_chosen_at` : le livre repasse en automatique.
 *
 * En TypeScript (`tsx`) pour réutiliser `findReplacementCover` — la même chaîne
 * que la réparation #53, zéro logique dupliquée. Comic Vine n'y est pas.
 *
 * ⚠️ Service role : la RLS ne protège pas ce script — chaque UPDATE cible un
 * `id` précis (la règle maison des scripts de prod).
 *
 * Usage :
 *   npx tsx scripts/covers-comicvine-detach.mts           → retrait réel
 *   npx tsx scripts/covers-comicvine-detach.mts --dry-run → liste sans écrire
 *
 * Env : NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, et les clés des
 * sources de remplacement (Metron, Google Books) — .env.local en local.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { findReplacementCover } from "@/lib/resolution/resolve";
import type { Database } from "@/lib/supabase/database.types";

const isDryRun = process.argv.includes("--dry-run");

// En local, .env.local complète l'environnement (jamais l'inverse).
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq < 1 || line.startsWith("#")) continue;
    const key = line.slice(0, eq).trim();
    if (!process.env[key]) process.env[key] = line.slice(eq + 1).trim();
  }
} catch {
  // Pas de .env.local (CI) : l'environnement doit suffire.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis");
  process.exit(1);
}

const admin = createClient<Database>(url, serviceRoleKey, { auth: { persistSession: false } });
const COMIC_VINE_PREFIX = "https://comicvine.gamespot.com/";
// Metron : 15 req/min pour toute l'app, 2-3 par UPC — 5 s entre deux fascicules
// (audit #274). Les ISBN ne touchent pas Metron : 500 ms suffisent.
const POLITENESS_DELAY_MS = { upc: 5000, isbn: 500 } as const;

const { data: books, error } = await admin
  .from("books")
  .select("id, user_id, title, barcode_type, barcode_raw, isbn, cover_url")
  .like("cover_url", `${COMIC_VINE_PREFIX}%`)
  .is("deleted_at", null);
if (error) throw new Error(`books : ${error.message}`);

console.log(`${books.length} livre(s) avec une couverture Comic Vine${isDryRun ? " (dry-run)" : ""}`);

let replaced = 0;
let cleared = 0;
for (const book of books) {
  // La politesse envers les sources, AVANT chaque résolution (y compris après
  // un livre non touché).
  const barcodeType = book.barcode_type;
  await new Promise((resolve) => setTimeout(resolve, POLITENESS_DELAY_MS[barcodeType === "upc" ? "upc" : "isbn"]));
  const replacement = barcodeType ? await findReplacementCover({ barcodeType, isbn: book.isbn, barcode: book.barcode_raw }) : null;
  // Un fascicule sans remplaçante n'est PAS vidé (audit #274) : un quota Metron
  // épuisé rend null comme une absence — on garde le lien Comic Vine et on
  // relance le script plus tard, plutôt que d'effacer une couverture par erreur.
  if (replacement === null && barcodeType === "upc") {
    console.log(` - ${book.title} → rien trouvé chez Metron (quota ou absence) : non touché, à relancer`);
    continue;
  }
  console.log(` - ${book.title} → ${replacement ?? "(rien : placeholder)"}`);
  if (!isDryRun) {
    const { error: updateError, count } = await admin
      .from("books")
      .update({ cover_url: replacement, cover_chosen_at: null }, { count: "exact" })
      .eq("id", book.id)
      .eq("user_id", book.user_id)
      .eq("cover_url", book.cover_url as string);
    if (updateError) throw new Error(`update ${book.id} : ${updateError.message}`);
    // Une course perdue (choix concurrent) n'est pas un retrait (review #284).
    if (count !== 1) {
      console.log("   (couverture changée entre-temps : non touché)");
      continue;
    }
  }
  if (replacement) replaced += 1;
  else cleared += 1;
}
console.log(`${replaced} remplacée(s), ${cleared} vidée(s)${isDryRun ? " — rien n'a été écrit" : ""}.`);
