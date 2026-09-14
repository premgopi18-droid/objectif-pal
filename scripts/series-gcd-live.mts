/**
 * GCD en direct (#308, suivi de séries §4.17-4) — chaque nuit, avant la
 * synchronisation des faits (`series:gcd-facts`).
 *
 * Le dump GCD (3,76 Go, cookie de session exigé) se recharge à la main, une
 * fois par mois. Entre deux, l'API REST publique de comics.org dit pour une
 * série DÉJÀ RELIÉE à notre référentiel : sa fin, ses fascicules parus, et pour
 * chaque fascicule nouveau son ISBN et son code-barres. Ce job relit ces
 * séries (en cours d'abord, closes une fois par mois) et pose :
 *   - dans `gcd_series` : `issue_count`, `last_number` (jamais en baisse),
 *     `year_ended`, `is_current` (vers `false` seulement), `live_checked_at` ;
 *   - dans `gcd_issues` : les fascicules absents (10 par série et par nuit,
 *     200 par nuit), normalisés comme l'export — le tome paru hier chez Urban
 *     se scanne et s'affiche comme manquant la nuit qui suit son indexation.
 * Le rechargement du dump écrase ces lignes par les siennes (qui les
 * contiennent alors) et vide `live_checked_at` : tout se relit, c'est voulu.
 *
 * Politesse : une requête par seconde, `OUTBOUND_USER_AGENT`, 200 appels série
 * + 200 appels fascicule par nuit, budget 15 min. Panne ≠ absence : une série
 * qui ne répond pas n'est pas datée (elle repasse demain) ; une série disparue
 * chez GCD (404) est journalisée, datée, jamais supprimée ; 0 réponse pour au
 * moins une cible = run rouge (Cloudflare qui refuse le runner, panne).
 *
 * Usage :
 *   npm run series:gcd-live              → run réel
 *   npm run series:gcd-live -- --dry-run → compte sans écrire
 * Env : NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Quotidien en CI
 * (series.yml) et à la main.
 */

import { setTimeout as sleep } from "node:timers/promises";
import { createGcdLiveProvider, type GcdLiveIssue } from "@/lib/resolution/providers/gcd-live";
import { fetchAllRows } from "@/lib/supabase/pagination";
import type { Database } from "@/lib/supabase/database.types";
import { createAdminClientFromEnv, isDryRun } from "./lib/env.mjs";
import {
  LIVE_ISSUE_LIMIT,
  LIVE_ISSUES_PER_SERIES,
  LIVE_POLITENESS_DELAY_MS,
  LIVE_RUN_BUDGET_MS,
  LIVE_RUN_LIMIT,
  liveRunExitCode,
  selectLiveTargets,
  seriesPatchFrom,
  type LiveRunCounts,
  type LiveTarget,
} from "./series-gcd-live-plan.mjs";

type IssueInsert = Database["public"]["Tables"]["gcd_issues"]["Insert"];

const dryRun = isDryRun();
const { admin } = createAdminClientFromEnv();
const gcd = createGcdLiveProvider();
/** Même garde que la RPC `sync_series_facts_from_gcd` : un identifiant GCD est un entier. */
const GCD_ID_PATTERN = /^\d{1,9}$/;

// 1. Les séries GCD reliées à notre référentiel.
const { data: links, error: linksError } = await admin.from("series_external_ids").select("external_id").eq("source", "gcd");
if (linksError) throw new Error(`series_external_ids : ${linksError.message}`);
const gcdIds = [...new Set(links.map((link) => link.external_id).filter((id) => GCD_ID_PATTERN.test(id)).map(Number))];

// 2. Leur état chez nous — c'est lui qu'on met à jour.
const known: LiveTarget[] = [];
for (let index = 0; index < gcdIds.length; index += 200) {
  const { data: rows, error } = await admin
    .from("gcd_series")
    .select("id, name, is_current, year_ended, issue_count, last_number, live_checked_at")
    .in("id", gcdIds.slice(index, index + 200));
  if (error) throw new Error(`gcd_series : ${error.message}`);
  for (const row of rows) {
    known.push({
      gcdId: row.id,
      name: row.name,
      isCurrent: row.is_current,
      yearEnded: row.year_ended,
      issueCount: row.issue_count,
      lastNumber: row.last_number,
      liveCheckedAt: row.live_checked_at,
    });
  }
}

const targets = selectLiveTargets(known, new Date(), LIVE_RUN_LIMIT);
console.log(`${known.length} séries GCD reliées, ${targets.length} relues ce run${dryRun ? " (dry-run)" : ""}`);

const counts: LiveRunCounts = { targets: targets.length, answered: 0, updated: 0, issuesAdded: 0, gone: 0, networkErrors: 0, infraErrors: 0 };
const startedAt = Date.now();
let issueBudget = LIVE_ISSUE_LIMIT;
let stoppedByBudget = 0;

/** Les lignes `gcd_issues` d'un fascicule : une par code-barres, ou une seule par l'ISBN — rien s'il n'est pas scannable (comme l'export). */
const issueRows = (issue: GcdLiveIssue, seriesId: number): IssueInsert[] => {
  if (issue.isbn === null && issue.barcodes.length === 0) return [];
  const shared: IssueInsert = {
    gcd_id: issue.gcdId,
    series_id: issue.seriesId ?? seriesId,
    number: issue.number,
    title: issue.title,
    key_date: issue.keyDate,
    isbn: issue.isbn,
    page_count: issue.pageCount,
    barcode: null,
    barcode_prefix: null,
  };
  if (issue.barcodes.length === 0) return [shared];
  return issue.barcodes.map((code) => ({ ...shared, barcode: code, barcode_prefix: code.slice(0, 12) }));
};

for (const target of targets) {
  // Le budget : on s'arrête proprement, le bilan sort, le reste repasse demain (déjà en tête de file).
  if (Date.now() - startedAt > LIVE_RUN_BUDGET_MS) {
    stoppedByBudget += 1;
    continue;
  }
  const label = `« ${target.name ?? "?"} » #${target.gcdId}`;

  let live;
  try {
    live = await gcd.getSeries(target.gcdId);
  } catch (error) {
    counts.networkErrors += 1;
    console.error(`  ${label} : ${error instanceof Error ? error.message : String(error)}`);
    await sleep(LIVE_POLITENESS_DELAY_MS);
    continue;
  }
  await sleep(LIVE_POLITENESS_DELAY_MS);
  const now = new Date().toISOString();

  if (live === null) {
    counts.gone += 1;
    console.warn(`  ${label} : disparue chez GCD (fusionnée ou supprimée) — lien conservé, à regarder`);
    if (!dryRun) {
      const { error } = await admin.from("gcd_series").update({ live_checked_at: now }).eq("id", target.gcdId);
      if (error) counts.infraErrors += 1;
    }
    continue;
  }
  counts.answered += 1;
  const patch = seriesPatchFrom(target, live);

  // 3. Les fascicules que le dump n'a pas — toutes les lignes existantes de la série (une série VO peut en avoir plus de 1 000).
  const existing = await fetchAllRows<{ gcd_id: number }>(async (from, to) => {
    const { data, error } = await admin.from("gcd_issues").select("gcd_id").eq("series_id", target.gcdId).order("gcd_id").range(from, to);
    if (error) throw new Error(`gcd_issues : ${error.message}`);
    return data;
  });
  const existingIds = new Set(existing.map((row) => row.gcd_id));
  const missingIds = live.issueIds.filter((id) => !existingIds.has(id)).slice(0, LIVE_ISSUES_PER_SERIES);

  const rows: IssueInsert[] = [];
  for (const issueId of missingIds) {
    if (issueBudget <= 0) break;
    issueBudget -= 1;
    let issue;
    try {
      issue = await gcd.getIssue(issueId);
    } catch (error) {
      counts.networkErrors += 1;
      console.error(`  ${label} fascicule ${issueId} : ${error instanceof Error ? error.message : String(error)}`);
      await sleep(LIVE_POLITENESS_DELAY_MS);
      continue;
    }
    await sleep(LIVE_POLITENESS_DELAY_MS);
    if (issue !== null) rows.push(...issueRows(issue, target.gcdId));
  }

  const changes = Object.entries(patch).map(([key, value]) => `${key} → ${value}`);
  console.log(
    `  ${label} : ${live.issueCount} fascicules, dernier ${live.lastNumber ?? "?"}, fin ${live.yearEnded ?? "—"}` +
      (changes.length > 0 ? ` | ${changes.join(", ")}` : "") +
      (rows.length > 0 ? ` | +${rows.length} ligne${rows.length > 1 ? "s" : ""} (${rows.map((row) => row.number ?? "?").join(", ")})` : ""),
  );
  if (dryRun) continue;

  if (rows.length > 0) {
    const { error } = await admin.from("gcd_issues").insert(rows);
    if (error) {
      counts.infraErrors += 1;
      console.error(`  ${label} gcd_issues : ${error.message}`);
    } else counts.issuesAdded += rows.length;
  }
  const { error } = await admin
    .from("gcd_series")
    .update({ ...patch, live_checked_at: now })
    .eq("id", target.gcdId);
  if (error) {
    counts.infraErrors += 1;
    console.error(`  ${label} gcd_series : ${error.message}`);
  } else if (changes.length > 0) counts.updated += 1;
}

console.log("\nBilan :");
console.log(`  séries relues : ${counts.answered} sur ${counts.targets} · mises à jour : ${counts.updated} · fascicules ajoutés : ${counts.issuesAdded}`);
console.log(`  disparues chez GCD : ${counts.gone} · erreurs réseau : ${counts.networkErrors} · erreurs de notre côté : ${counts.infraErrors}`);
if (stoppedByBudget > 0) console.log(`  budget de run atteint : ${stoppedByBudget} séries repassent demain`);
console.log(dryRun ? "\nDry-run : rien n'a été écrit." : "\nÉcrit — la synchronisation des faits (series:gcd-facts) suit.");
process.exit(liveRunExitCode(counts));
