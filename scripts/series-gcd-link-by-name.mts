/**
 * Rattachement des séries orphelines à GCD, par nom + éditeur (#309).
 *
 * 73 séries du référentiel n'ont aucun lien GCD (mesure du 14/09/2026) —
 * surtout des comics VF Panini identifiés par la BnF, que GCD n'indexe pas par
 * ISBN. Pour certaines, GCD a pourtant UNE série française du même nom chez le
 * même éditeur (Batwoman chez Urban, Witchblade chez Delcourt, Excalibur chez
 * Panini…). Un nom seul est interdit (Spider-Man : 8 homonymes) : le verdict
 * pur `pickGcdCandidate` exige le même nom normalisé, la même famille
 * d'éditeur (table explicite) et un candidat UNIQUE. L'année de parution n'est
 * pas stockée sur le livre : pas de filtre d'année aujourd'hui (le verdict le
 * prévoit, `oldestYear` reste `null`) ; en revanche le plus grand tome possédé
 * borne une édition close, et toute édition close est marquée « à vérifier »
 * (review #312 : Generation X → Panini 1999 n'est pas l'édition de 2024).
 *
 * Jamais automatique : dry-run par défaut, Prem valide la liste, puis
 * `--apply` (au besoin `--only=<seriesId,…>` pour n'en poser qu'une partie).
 * Le lien est un `series_external_ids (source 'gcd')` de plus — un identifiant
 * déjà porté par une autre série n'est jamais volé (ON CONFLICT DO NOTHING,
 * leçon #305), il est listé « déjà porté ». Le fait suit au prochain
 * `series:gcd-live` + `series:gcd-facts`.
 *
 * Usage :
 *   npm run series:gcd-link-by-name                       → DRY-RUN
 *   npm run series:gcd-link-by-name -- --apply            → écrit
 *   npm run series:gcd-link-by-name -- --apply --only=a,b → écrit ces séries seulement
 * Env : NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. One-shot.
 */

import { parseVolumeNumber } from "@/lib/resolution/volume-number";
import { pickGcdCandidate, type GcdSeriesCandidate } from "@/lib/series/gcd-link-candidates";
import { fetchAllRows } from "@/lib/supabase/pagination";
import { createAdminClientFromEnv } from "./lib/env.mjs";

const apply = process.argv.includes("--apply");
const onlyArgument = process.argv.find((argument) => argument.startsWith("--only="));
const only = onlyArgument === undefined ? null : new Set(onlyArgument.slice("--only=".length).split(",").filter(Boolean));
const { admin } = createAdminClientFromEnv();
const FRENCH_LANGUAGE_ID = 34;
const CANDIDATE_LIMIT = 50;

// 1. Les séries sans lien GCD.
const { data: seriesRows, error: seriesError } = await admin.from("series").select("id, name");
if (seriesError) throw new Error(`series : ${seriesError.message}`);
const { data: gcdLinks, error: linksError } = await admin.from("series_external_ids").select("series_id").eq("source", "gcd");
if (linksError) throw new Error(`series_external_ids : ${linksError.message}`);
const linked = new Set(gcdLinks.map((link) => link.series_id));

// 2. Leurs livres (tous comptes : le référentiel est partagé) — l'éditeur majoritaire.
type BookRow = { series_id: string | null; publisher: string | null; issue_number: string | null };
const books = await fetchAllRows<BookRow>(async (from, to) => {
  const { data, error } = await admin.from("books").select("series_id, publisher, issue_number").not("series_id", "is", null).is("deleted_at", null).order("id").range(from, to);
  if (error) throw new Error(`books : ${error.message}`);
  return data;
});
const publishersBySeries = new Map<string, Map<string, number>>();
// Le plus grand tome numérique par série : une édition close ne peut pas en avoir moins (review #312).
const maxNumberBySeries = new Map<string, number>();
for (const book of books) {
  if (book.series_id === null) continue;
  const number = parseVolumeNumber(book.issue_number);
  if (number !== null) maxNumberBySeries.set(book.series_id, Math.max(maxNumberBySeries.get(book.series_id) ?? 0, Number(number)));
  if (book.publisher === null) continue;
  const counts = publishersBySeries.get(book.series_id) ?? new Map<string, number>();
  counts.set(book.publisher, (counts.get(book.publisher) ?? 0) + 1);
  publishersBySeries.set(book.series_id, counts);
}
const majorityPublisher = (seriesId: string): string | null => {
  const counts = publishersBySeries.get(seriesId);
  if (!counts) return null;
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
};
const withBooks = new Set(books.flatMap((book) => (book.series_id === null ? [] : [book.series_id])));
const orphans = seriesRows.filter((series) => !linked.has(series.id) && withBooks.has(series.id) && (only === null || only.has(series.id)));
console.log(`${seriesRows.length} séries, ${orphans.length} sans lien GCD avec au moins un livre${apply ? "" : " (dry-run)"}`);

// PostgREST : « % » et « _ » sont des jokers d'ilike ; on les échappe pour un égal insensible à la casse.
// « * » est aussi traduit en joker par PostgREST et ne s'échappe pas : sans conséquence, le verdict
// recompare ensuite le nom normalisé exact (review #312).
const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (character) => `\\${character}`);

const counts = { unique: 0, ambiguous: 0, noFamily: 0, noMatch: 0, posed: 0, alreadyHeld: 0, errors: 0 };
const toLink: { seriesId: string; name: string; candidate: GcdSeriesCandidate }[] = [];

for (const series of orphans.sort((left, right) => left.name.localeCompare(right.name, "fr"))) {
  const publisher = majorityPublisher(series.id);
  const { data, error } = await admin
    .from("gcd_series")
    .select("id, name, publisher, year_began, year_ended, is_current, last_number")
    .eq("language_id", FRENCH_LANGUAGE_ID)
    .ilike("name", escapeLike(series.name))
    .limit(CANDIDATE_LIMIT);
  if (error) {
    counts.errors += 1;
    console.error(`  « ${series.name} » : ${error.message}`);
    continue;
  }
  const candidates: GcdSeriesCandidate[] = data.map((row) => ({
    id: row.id,
    name: row.name,
    publisher: row.publisher,
    yearBegan: row.year_began,
    yearEnded: row.year_ended,
    isCurrent: row.is_current,
    lastNumber: row.last_number,
  }));
  const verdict = pickGcdCandidate({ seriesName: series.name, publisher, oldestYear: null, maxOwnedNumber: maxNumberBySeries.get(series.id) ?? null, candidates });
  const describe = (candidate: GcdSeriesCandidate) =>
    `GCD #${candidate.id} (${candidate.publisher ?? "?"}, ${candidate.yearBegan ?? "?"}, ${candidate.isCurrent ? "en cours" : `close, dernier ${candidate.lastNumber ?? "?"}`})`;
  const head = `  « ${series.name} » [${series.id.slice(0, 8)}…] | ${publisher ?? "éditeur inconnu"}`;
  if (verdict.kind === "unique") {
    counts.unique += 1;
    console.log(`${head} → ${describe(verdict.candidate)}${verdict.closedEdition ? " ⚠ édition close : vérifier que c'est bien la tienne" : ""}`);
    toLink.push({ seriesId: series.id, name: series.name, candidate: verdict.candidate });
  } else if (verdict.kind === "ambiguous") {
    counts.ambiguous += 1;
    console.log(`${head} → AMBIGU : ${verdict.candidates.map(describe).join(" ; ")}`);
  } else if (verdict.reason === "no-family") {
    counts.noFamily += 1;
    console.log(`${head} → éditeur hors table (${candidates.length} homonyme${candidates.length > 1 ? "s" : ""} GCD, non départagé${candidates.length > 1 ? "s" : ""})`);
  } else {
    counts.noMatch += 1;
    console.log(`${head} → aucune série GCD française du même nom chez cet éditeur`);
  }
}

if (apply) {
  for (const link of toLink) {
    const { data: inserted, error } = await admin
      .from("series_external_ids")
      .upsert({ series_id: link.seriesId, source: "gcd", external_id: String(link.candidate.id) }, { onConflict: "source,external_id", ignoreDuplicates: true })
      .select("series_id");
    if (error) {
      counts.errors += 1;
      console.error(`  series_external_ids « ${link.name} » : ${error.message}`);
    } else if (inserted && inserted.length > 0) counts.posed += 1;
    else {
      counts.alreadyHeld += 1;
      console.log(`  « ${link.name} » : GCD #${link.candidate.id} déjà porté par une autre série — non posé, fusion à envisager`);
    }
  }
}

console.log("\nBilan :");
console.log(`  candidats uniques : ${counts.unique} · ambigus : ${counts.ambiguous} · éditeur hors table : ${counts.noFamily} · sans homonyme : ${counts.noMatch} · erreurs : ${counts.errors}`);
if (apply) console.log(`  liens posés : ${counts.posed} · déjà portés : ${counts.alreadyHeld}`);
console.log(apply ? "\nÉcrit — le fait suit au prochain series:gcd-live + series:gcd-facts." : "\nDry-run : rien n'a été écrit. Valider la liste, puis relancer avec --apply (ou --only=<ids>).");
if (counts.errors > 0) process.exit(1);
