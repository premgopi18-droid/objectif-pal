/**
 * Rattachement du parc au référentiel de séries (lot A de l'epic #289, #291,
 * specs §4.17 décision 9 du ticket).
 *
 * Avant ce lot, une série n'existait pas en base. Ce script relie UNE fois
 * tous les livres vivants qui ont un `series_name` et pas de `series_id`, en
 * passant par la MÊME RPC que le scan (`find_or_create_series`) — une seule
 * logique de rattachement, pas deux :
 *   1. l'identifiant GCD : `metadata_source = 'gcd'` → `gcd_issues.series_id`
 *      (⚠️ `gcd_id` n'est pas unique — plusieurs lignes = variantes ; si elles
 *      pointent deux séries différentes, on n'en retient aucune) ;
 *   2. l'identifiant BnF : `barcode_cache.series_external_id` posé par le lot 0
 *      pour l'ISBN du livre ;
 *   3. sinon le nom normalisé.
 * Sous service role, `created_by` reste null (« système »).
 *
 * Usage :
 *   npm run series:link-backfill            → DRY-RUN : compte, ne relie rien
 *   npm run series:link-backfill -- --apply → relie
 *
 * Env : NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. One-shot,
 * idempotent (ne touche que `series_id is null`).
 */

import { fetchAllRows } from "@/lib/supabase/pagination";
import type { Database } from "@/lib/supabase/database.types";
import { createAdminClientFromEnv } from "./lib/env.mjs";

const apply = process.argv.includes("--apply");
const { admin } = createAdminClientFromEnv();

type BookRow = {
  id: string;
  user_id: string;
  series_name: string;
  category: Database["public"]["Enums"]["book_category"];
  metadata_source: Database["public"]["Enums"]["metadata_source"];
  metadata_source_id: string | null;
  isbn: string | null;
};

const CHUNK = 200;
const chunks = <T,>(items: T[]): T[][] =>
  Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, index) => items.slice(index * CHUNK, (index + 1) * CHUNK));

const books = await fetchAllRows<BookRow>(async (from, to) => {
  const { data, error } = await admin
    .from("books")
    .select("id, user_id, series_name, category, metadata_source, metadata_source_id, isbn")
    .not("series_name", "is", null)
    .is("series_id", null)
    .is("deleted_at", null)
    .order("id")
    .range(from, to);
  if (error) throw new Error(`books : ${error.message}`);
  return data as BookRow[];
});
console.log(`${books.length} livres avec une série et sans lien${apply ? "" : " (dry-run)"}`);

// 1. Les identifiants GCD, par gcd_id — un seul appel par paquet.
const gcdIds = [...new Set(books.filter((book) => book.metadata_source === "gcd").map((book) => Number(book.metadata_source_id)).filter(Number.isInteger))];
const gcdSeriesByIssue = new Map<number, number | "ambiguous">();
for (const chunk of chunks(gcdIds)) {
  const { data, error } = await admin.from("gcd_issues").select("gcd_id, series_id").in("gcd_id", chunk);
  if (error) throw new Error(`gcd_issues : ${error.message}`);
  for (const row of data) {
    if (row.series_id === null) continue;
    const known = gcdSeriesByIssue.get(row.gcd_id);
    if (known === undefined) gcdSeriesByIssue.set(row.gcd_id, row.series_id);
    else if (known !== row.series_id) gcdSeriesByIssue.set(row.gcd_id, "ambiguous");
  }
}

// 2. Les identifiants BnF, par ISBN, depuis le cache du lot 0.
const isbns = [...new Set(books.map((book) => book.isbn).filter((isbn): isbn is string => isbn !== null))];
const bnfSeriesByIsbn = new Map<string, string>();
for (const chunk of chunks(isbns)) {
  const { data, error } = await admin
    .from("barcode_cache")
    .select("barcode, series_external_id")
    .eq("series_external_source", "bnf")
    .in("barcode", chunk);
  if (error) throw new Error(`barcode_cache : ${error.message}`);
  for (const row of data) if (row.series_external_id) bnfSeriesByIsbn.set(row.barcode, row.series_external_id);
}

const counters = { linked: 0, byGcd: 0, byBnf: 0, byName: 0, ambiguousGcd: 0, errors: 0 };
const seriesIdsSeen = new Set<string>();
const linkedByUser = new Map<string, number>();

for (const book of books) {
  const gcdIssueId = book.metadata_source === "gcd" ? Number(book.metadata_source_id) : NaN;
  const gcdSeries = Number.isInteger(gcdIssueId) ? gcdSeriesByIssue.get(gcdIssueId) : undefined;
  if (gcdSeries === "ambiguous") counters.ambiguousGcd += 1;
  const gcdSeriesId = typeof gcdSeries === "number" ? String(gcdSeries) : undefined;
  const bnfSeriesId = book.isbn ? bnfSeriesByIsbn.get(book.isbn) : undefined;

  if (gcdSeriesId) counters.byGcd += 1;
  else if (bnfSeriesId) counters.byBnf += 1;
  else counters.byName += 1;
  linkedByUser.set(book.user_id, (linkedByUser.get(book.user_id) ?? 0) + 1);
  if (!apply) continue;

  const { data: seriesId, error } = await admin.rpc("find_or_create_series", {
    p_name: book.series_name,
    p_category: book.category,
    p_gcd_series_id: gcdSeriesId,
    p_bnf_series_id: bnfSeriesId,
  });
  if (error || !seriesId) {
    counters.errors += 1;
    console.error(`  ${book.id} « ${book.series_name} » : ${error?.message ?? "pas d'id"}`);
    continue;
  }
  seriesIdsSeen.add(seriesId);
  // `series_id is null` répété : si le propriétaire a relié entre-temps, sa saisie gagne.
  const { error: updateError } = await admin.from("books").update({ series_id: seriesId }).eq("id", book.id).is("series_id", null);
  if (updateError) {
    counters.errors += 1;
    console.error(`  books ${book.id} : ${updateError.message}`);
    continue;
  }
  counters.linked += 1;
}

console.log("\nBilan :");
console.log(`  à relier : ${books.length} (par GCD ${counters.byGcd}, par BnF ${counters.byBnf}, par nom seul ${counters.byName})`);
console.log(`  GCD ambigu (variantes sur deux séries — nom seul) : ${counters.ambiguousGcd}`);
if (apply) console.log(`  reliés : ${counters.linked} → ${seriesIdsSeen.size} séries distinctes`);
console.log(`  erreurs : ${counters.errors}`);
console.log("  par compte (user_id abrégé) :");
for (const [userId, count] of linkedByUser) console.log(`    ${userId.slice(0, 8)}… : ${count}`);
console.log(apply ? "\nRelié." : "\nDry-run : rien n'a été écrit. Relancer avec --apply pour relier.");
if (counters.errors > 0) process.exit(1);
