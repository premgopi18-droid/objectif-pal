/**
 * Le fait de série depuis AniList, pour le MANGA (#304, §4.17-4).
 *
 * Aucune source ouverte ne décrit les parutions françaises ; pour le manga,
 * AniList décrit l'œuvre et une édition française normale partage son
 * découpage et son statut (mesuré : 15 séries sur 20 reconnues en
 * rapprochement STRICT, 0 erreur). Priorité humain > AniList > GCD.
 *
 * Pour chaque série manga sans fait humain : relecture par id si AniList est
 * déjà rapproché, sinon recherche par titre + `matchAniListStrict` (jamais le
 * premier résultat) ; l'id trouvé est mémorisé sur series_external_ids ; le
 * fait part par `declare_series_fact_from_source` (n'écrit que ce qui change,
 * jamais par-dessus un humain). Une série non reconnue est datée
 * (`anilist_searched_at`) et retentée après une semaine.
 *
 * Usage :
 *   npm run series:anilist-facts              → run réel
 *   npm run series:anilist-facts -- --dry-run → compte sans écrire
 * Env : NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Chaque nuit
 * (series.yml) après GCD, et à la main.
 */

import { setTimeout as sleep } from "node:timers/promises";
import { createAniListProvider, factFromAniList, matchAniListStrict } from "@/lib/resolution/providers/anilist";
import { fetchAllRows } from "@/lib/supabase/pagination";
import type { Database } from "@/lib/supabase/database.types";
import { createAdminClientFromEnv, isDryRun } from "./lib/env.mjs";
import {
  ANILIST_POLITENESS_DELAY_MS,
  ANILIST_RUN_BUDGET_MS,
  ANILIST_RUN_LIMIT,
  aniListRunExitCode,
  majorityCategory,
  selectAniListTargets,
  type AniListRunCounts,
  type AniListTarget,
} from "./series-anilist-plan.mjs";

const dryRun = isDryRun();
const { admin } = createAdminClientFromEnv();
const anilist = createAniListProvider();

type LinkedBook = { series_id: string | null; category: Database["public"]["Enums"]["book_category"] };

// 1. Les séries MANGA : la majorité des livres reliés (tous comptes — c'est le
//    référentiel commun) sont en catégorie manga.
const books = await fetchAllRows<LinkedBook>(async (from, to) => {
  const { data, error } = await admin.from("books").select("series_id, category").not("series_id", "is", null).is("deleted_at", null).order("id").range(from, to);
  if (error) throw new Error(`books : ${error.message}`);
  return data as LinkedBook[];
});
const categoriesBySeries = new Map<string, LinkedBook["category"][]>();
for (const book of books) if (book.series_id) categoriesBySeries.set(book.series_id, [...(categoriesBySeries.get(book.series_id) ?? []), book.category]);
const mangaSeriesIds = [...categoriesBySeries].filter(([, categories]) => majorityCategory(categories) === "manga").map(([seriesId]) => seriesId);

const targets: AniListTarget[] = [];
for (let index = 0; index < mangaSeriesIds.length; index += 200) {
  const chunk = mangaSeriesIds.slice(index, index + 200);
  const [{ data: series, error }, { data: links, error: linksError }] = await Promise.all([
    admin.from("series").select("id, name, fact_source, fact_declared_at, anilist_searched_at").in("id", chunk),
    admin.from("series_external_ids").select("series_id, external_id").eq("source", "anilist").in("series_id", chunk),
  ]);
  if (error) throw new Error(`series : ${error.message}`);
  if (linksError) throw new Error(`series_external_ids : ${linksError.message}`);
  const idBySeries = new Map(links.map((link) => [link.series_id, Number(link.external_id)]));
  for (const row of series) {
    targets.push({
      seriesId: row.id,
      name: row.name,
      aniListId: idBySeries.get(row.id) ?? null,
      lastSearchedAt: row.anilist_searched_at,
      factSource: row.fact_source === "gcd" || row.fact_source === "anilist" ? row.fact_source : "human",
      hasFact: row.fact_declared_at !== null,
    });
  }
}

const selected = selectAniListTargets(targets, new Date(), ANILIST_RUN_LIMIT);
console.log(`${mangaSeriesIds.length} séries manga, ${selected.length} relues ce run${dryRun ? " (dry-run)" : ""}`);

const counts: AniListRunCounts = { processed: 0, matched: 0, unmatched: 0, declared: 0, networkErrors: 0, infraErrors: 0 };
const startedAt = Date.now();
const now = new Date().toISOString();

for (const target of selected) {
  if (Date.now() - startedAt > ANILIST_RUN_BUDGET_MS) break;
  counts.processed += 1;

  let media = null;
  try {
    media = target.aniListId !== null ? await anilist.getManga(target.aniListId) : matchAniListStrict(target.name, await anilist.searchManga(target.name));
  } catch (error) {
    counts.networkErrors += 1;
    console.error(`  « ${target.name} » : ${error instanceof Error ? error.message : String(error)}`);
    await sleep(ANILIST_POLITENESS_DELAY_MS);
    continue;
  }

  if (media === null) {
    counts.unmatched += 1;
    if (!dryRun && target.aniListId === null) {
      const { error } = await admin.from("series").update({ anilist_searched_at: now }).eq("id", target.seriesId);
      if (error) {
        counts.infraErrors += 1;
        console.error(`  series ${target.seriesId} : ${error.message}`);
      }
    }
    await sleep(ANILIST_POLITENESS_DELAY_MS);
    continue;
  }

  counts.matched += 1;
  const fact = factFromAniList(media);
  const summary = fact === null ? "rien d'exploitable" : "totalVolumes" in fact ? `terminé, ${fact.totalVolumes} volumes` : "en cours";
  console.log(`  « ${target.name} » → AniList ${media.id} (${media.titles[0]}) : ${summary}`);
  if (dryRun) {
    await sleep(ANILIST_POLITENESS_DELAY_MS);
    continue;
  }

  if (target.aniListId === null) {
    const { error } = await admin.from("series_external_ids").upsert(
      { series_id: target.seriesId, source: "anilist", external_id: String(media.id) },
      { onConflict: "source,external_id" },
    );
    if (error) {
      counts.infraErrors += 1;
      console.error(`  series_external_ids ${target.seriesId} : ${error.message}`);
    }
    const { error: searchedError } = await admin.from("series").update({ anilist_searched_at: now }).eq("id", target.seriesId);
    if (searchedError) console.error(`  series ${target.seriesId} : ${searchedError.message}`);
  }
  if (fact !== null) {
    const { data: changed, error } = await admin.rpc("declare_series_fact_from_source", {
      p_series_id: target.seriesId,
      p_source: "anilist",
      p_total_volumes: "totalVolumes" in fact ? fact.totalVolumes : undefined,
      p_is_ongoing: "isOngoing" in fact,
    });
    if (error) {
      counts.infraErrors += 1;
      console.error(`  declare_series_fact_from_source ${target.seriesId} : ${error.message}`);
    } else if (changed) {
      counts.declared += 1;
    }
  }
  await sleep(ANILIST_POLITENESS_DELAY_MS);
}

console.log("\nBilan :");
console.log(`  séries relues : ${counts.processed} · reconnues : ${counts.matched} · non reconnues : ${counts.unmatched}`);
console.log(`  faits déclarés ou mis à jour : ${counts.declared}`);
console.log(`  erreurs réseau : ${counts.networkErrors} · erreurs de notre côté : ${counts.infraErrors}`);
console.log(dryRun ? "\nDry-run : rien n'a été écrit." : "\nÉcrit.");
process.exit(aniListRunExitCode(counts));
