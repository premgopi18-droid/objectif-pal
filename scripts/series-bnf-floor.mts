/**
 * Le plancher VF par édition (#299, suite de l'epic séries #289, §4.17-4).
 *
 * Pour chaque série qui porte un identifiant d'édition BnF (461 $0, posé au
 * scan et au rattachement), une recherche titre + auteur chez la BnF,
 * regroupée par cet identifiant, donne le plus grand tome DÉPOSÉ pour cette
 * édition (One Piece Glénat → 111, mesuré le 14/09/2026). Il est posé sur
 * l'identifiant (`series_external_ids.known_max`, avec l'éditeur et la date)
 * — jamais sur la série, jamais comme une vérité : la fiche s'en sert pour
 * pré-remplir le stepper et signaler un total dépassé.
 *
 * Lent (2 à 20 s par série) : un job de NUIT, une série à la fois, 250 ms de
 * politesse, pages de 100 plafonnées à 5, 60 s par page, 150 séries par run
 * (jamais relues d'abord, puis les plus anciennes — le parc se rattrape en
 * quelques nuits puis se rafraîchit de fait chaque semaine). Un plancher
 * introuvable est daté quand même (la série repasse en fin de file) ; un
 * échec réseau n'écrit rien.
 *
 * Usage :
 *   npm run series:bnf-floor              → run réel
 *   npm run series:bnf-floor -- --dry-run → compte sans écrire
 * Env : NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Quotidien en CI
 * (series.yml) et à la main.
 */

import { setTimeout as sleep } from "node:timers/promises";
import { createBnfProvider } from "@/lib/resolution/providers/bnf";
import { createAdminClientFromEnv, isDryRun } from "./lib/env.mjs";
import {
  authorSearchName,
  FLOOR_MAX_PAGES,
  FLOOR_PAGE_TIMEOUT_MS,
  FLOOR_POLITENESS_DELAY_MS,
  FLOOR_RUN_LIMIT,
  floorRunExitCode,
  selectFloorTargets,
  type FloorRunCounts,
  type FloorTarget,
} from "./series-bnf-floor-plan.mjs";

const dryRun = isDryRun();
const { admin } = createAdminClientFromEnv();
const bnf = createBnfProvider();

// 1. Les éditions BnF, avec leur série et leur dernière relecture.
const { data: links, error: linksError } = await admin
  .from("series_external_ids")
  .select("series_id, external_id, known_max_checked_at, series ( name )")
  .eq("source", "bnf");
if (linksError) throw new Error(`series_external_ids : ${linksError.message}`);

const targetsBySeries = new Map<string, FloorTarget>();
for (const link of links) {
  const name = link.series?.name;
  if (!name) continue;
  const target = targetsBySeries.get(link.series_id) ?? { seriesId: link.series_id, name, author: null, bnfSeriesIds: [], oldestCheckedAt: null };
  target.bnfSeriesIds.push(link.external_id);
  if (link.known_max_checked_at === null) target.oldestCheckedAt = null;
  else if (target.bnfSeriesIds.length === 1 || (target.oldestCheckedAt !== null && link.known_max_checked_at < target.oldestCheckedAt)) {
    target.oldestCheckedAt = link.known_max_checked_at;
  }
  targetsBySeries.set(link.series_id, target);
}

// 2. L'auteur : un fait du LIVRE (n'importe quel compte), le premier trouvé par série.
const seriesIds = [...targetsBySeries.keys()];
for (let index = 0; index < seriesIds.length; index += 200) {
  const chunk = seriesIds.slice(index, index + 200);
  const { data: books, error: booksError } = await admin
    .from("books")
    .select("series_id, authors")
    .in("series_id", chunk)
    .not("authors", "is", null)
    .is("deleted_at", null);
  if (booksError) throw new Error(`books : ${booksError.message}`);
  for (const book of books) {
    const target = book.series_id ? targetsBySeries.get(book.series_id) : undefined;
    if (target && target.author === null) target.author = authorSearchName(book.authors);
  }
}

const targets = selectFloorTargets([...targetsBySeries.values()], FLOOR_RUN_LIMIT);
console.log(`${targetsBySeries.size} séries à identifiant BnF, ${targets.length} relues ce run${dryRun ? " (dry-run)" : ""}`);

const counts: FloorRunCounts = { processed: 0, updated: 0, missing: 0, networkErrors: 0, infraErrors: 0 };
const now = new Date().toISOString();

for (const target of targets) {
  counts.processed += 1;
  let floors;
  try {
    floors = await bnf.searchSeriesFloors({
      title: target.name,
      author: target.author,
      seriesIds: target.bnfSeriesIds,
      maxPages: FLOOR_MAX_PAGES,
      timeoutMs: FLOOR_PAGE_TIMEOUT_MS,
    });
  } catch (error) {
    counts.networkErrors += 1;
    console.error(`  « ${target.name} » : ${error instanceof Error ? error.message : String(error)}`);
    await sleep(FLOOR_POLITENESS_DELAY_MS);
    continue;
  }

  for (const bnfSeriesId of target.bnfSeriesIds) {
    const floor = floors.get(bnfSeriesId) ?? null;
    if (floor) {
      counts.updated += 1;
      console.log(`  « ${target.name} » ${bnfSeriesId} → ${floor.knownMax} (${floor.label ?? "éditeur inconnu"}, ${floor.noticeCount} notices)`);
    } else {
      counts.missing += 1;
    }
    if (dryRun) continue;
    // Un plancher introuvable est daté quand même : la série repasse en fin de
    // file au lieu de bloquer la tête chaque nuit.
    const { error } = await admin
      .from("series_external_ids")
      .update({ known_max: floor?.knownMax ?? null, known_max_label: floor?.label ?? null, known_max_checked_at: now })
      .eq("source", "bnf")
      .eq("external_id", bnfSeriesId);
    if (error) {
      counts.infraErrors += 1;
      console.error(`  series_external_ids ${bnfSeriesId} : ${error.message}`);
    }
  }
  await sleep(FLOOR_POLITENESS_DELAY_MS);
}

console.log("\nBilan :");
console.log(`  séries relues : ${counts.processed}`);
console.log(`  planchers posés : ${counts.updated} · éditions sans plancher : ${counts.missing}`);
console.log(`  erreurs réseau : ${counts.networkErrors} · erreurs de notre côté : ${counts.infraErrors}`);
console.log(dryRun ? "\nDry-run : rien n'a été écrit." : "\nÉcrit.");
process.exit(floorRunExitCode(counts));
