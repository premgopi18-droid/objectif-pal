/**
 * Rattrapage des identifiants d'édition BnF (suite de #290 / #299, 14/09/2026).
 *
 * Le rattrapage du lot 0 ne relisait que les livres BnF SANS nom de série ;
 * ceux identifiés avant (nom déjà extrait du titre Dublin Core) n'ont jamais
 * reçu leur `461 $0` — donc pas d'identifiant d'édition sur leur série, donc
 * pas de plancher (vécu sur Dungeon Crawler Carl). Ce script relit UNE fois
 * les livres BnF reliés à une série qui n'a aucun identifiant BnF, et pose :
 *   - l'identifiant sur `series_external_ids` (ON CONFLICT DO NOTHING — un
 *     identifiant ne désigne qu'une série) ;
 *   - la référence dans `barcode_cache` (colonnes du lot 0) si elle manque.
 * Jamais le nom, le titre ni la couverture. Le plancher suit au prochain run
 * de `series:bnf-floor`.
 *
 * Usage :
 *   npm run series:bnf-refs            → DRY-RUN
 *   npm run series:bnf-refs -- --apply → écrit
 * Env : NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. One-shot.
 */

import { setTimeout as sleep } from "node:timers/promises";
import { createBnfProvider } from "@/lib/resolution/providers/bnf";
import { fetchAllRows } from "@/lib/supabase/pagination";
import { createAdminClientFromEnv } from "./lib/env.mjs";

const apply = process.argv.includes("--apply");
const { admin } = createAdminClientFromEnv();
const bnf = createBnfProvider();
const POLITENESS_DELAY_MS = 150;

type BookRow = { id: string; isbn: string; series_id: string };

const books = (await fetchAllRows<BookRow>(async (from, to) => {
  const { data, error } = await admin
    .from("books")
    .select("id, isbn, series_id")
    .eq("metadata_source", "bnf")
    .not("isbn", "is", null)
    .not("series_id", "is", null)
    .is("deleted_at", null)
    .order("isbn")
    .order("id")
    .range(from, to);
  if (error) throw new Error(`books : ${error.message}`);
  return data as BookRow[];
})).filter((book): book is BookRow => book.isbn !== null && book.series_id !== null);

// Les séries qui ont déjà un identifiant BnF n'ont rien à recevoir.
const seriesIds = [...new Set(books.map((book) => book.series_id))];
const withBnf = new Set<string>();
for (let index = 0; index < seriesIds.length; index += 200) {
  const { data, error } = await admin.from("series_external_ids").select("series_id").eq("source", "bnf").in("series_id", seriesIds.slice(index, index + 200));
  if (error) throw new Error(`series_external_ids : ${error.message}`);
  for (const row of data) withBnf.add(row.series_id);
}
const candidates = books.filter((book) => !withBnf.has(book.series_id));
const byIsbn = new Map<string, BookRow[]>();
for (const book of candidates) byIsbn.set(book.isbn, [...(byIsbn.get(book.isbn) ?? []), book]);
console.log(`${books.length} livres BnF reliés, ${candidates.length} sur une série sans identifiant BnF, ${byIsbn.size} ISBN à relire${apply ? "" : " (dry-run)"}`);

const counts = { relus: 0, avecId: 0, sansId: 0, inconnus: 0, erreurs: 0, idsPoses: 0 };
const seriesDone = new Set<string>();

for (const [isbn, rows] of byIsbn) {
  counts.relus += 1;
  let record;
  try {
    record = await bnf.resolveIsbn(isbn);
  } catch (error) {
    counts.erreurs += 1;
    console.error(`  ${isbn} : ${error instanceof Error ? error.message : String(error)}`);
    await sleep(POLITENESS_DELAY_MS);
    continue;
  }
  if (!record) counts.inconnus += 1;
  else if (!record.bnfSeriesId) counts.sansId += 1;
  else {
    counts.avecId += 1;
    for (const book of rows) {
      if (seriesDone.has(book.series_id)) continue;
      seriesDone.add(book.series_id);
      console.log(`  ${isbn} → série ${book.series_id.slice(0, 8)}… reçoit bnf:${record.bnfSeriesId} (« ${record.seriesName ?? "?"} »)`);
      if (!apply) continue;
      const { data: inserted, error } = await admin
        .from("series_external_ids")
        .upsert({ series_id: book.series_id, source: "bnf", external_id: record.bnfSeriesId }, { onConflict: "source,external_id", ignoreDuplicates: true })
        .select("series_id");
      if (error) {
        counts.erreurs += 1;
        console.error(`  series_external_ids ${book.series_id} : ${error.message}`);
      } else if (inserted && inserted.length > 0) counts.idsPoses += 1;
      else console.log(`    (identifiant déjà porté par une autre série — non posé)`);
    }
    if (apply) {
      const { error } = await admin
        .from("barcode_cache")
        .update({ series_external_source: "bnf", series_external_id: record.bnfSeriesId })
        .eq("barcode", isbn)
        .is("series_external_id", null);
      if (error) console.error(`  barcode_cache ${isbn} : ${error.message}`);
    }
  }
  await sleep(POLITENESS_DELAY_MS);
}

console.log("\nBilan :");
console.log(`  ISBN relus : ${counts.relus} · avec notice de série : ${counts.avecId} · sans : ${counts.sansId} · inconnus : ${counts.inconnus} · erreurs : ${counts.erreurs}`);
if (apply) console.log(`  identifiants posés : ${counts.idsPoses}`);
console.log(apply ? "\nÉcrit — le plancher suit au prochain run de series:bnf-floor." : "\nDry-run : rien n'a été écrit. Relancer avec --apply.");
if (counts.erreurs > 0) process.exit(1);
