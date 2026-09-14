/**
 * GCD en direct (#308, suivi de séries §4.17-4) — toutes les heures, suivi de
 * la synchronisation des faits (`series:gcd-facts`).
 *
 * Le dump GCD (3,76 Go, cookie de session exigé) se recharge à la main, une
 * fois par mois. Entre deux, l'API REST publique de comics.org dit pour une
 * série DÉJÀ RELIÉE à notre référentiel : sa fin, ses fascicules parus, et pour
 * chaque fascicule nouveau son ISBN et son code-barres. Ce job relit ces
 * séries (en cours d'abord, closes une fois par mois) et pose :
 *   - dans `gcd_series` : `issue_count`, `last_number` (jamais en baisse),
 *     `year_ended`, `is_current` (vers `false` seulement), `live_checked_at` ;
 *   - dans `gcd_issues` : les fascicules absents, normalisés comme l'export —
 *     le tome paru hier chez Urban se scanne et s'affiche comme manquant dans
 *     les heures qui suivent son indexation sur comics.org.
 * Le rechargement du dump écrase ces lignes par les siennes (qui les
 * contiennent alors) et vide `live_checked_at` : tout se relit, c'est voulu.
 *
 * L'API est anonyme et QUOTÉE SUR UNE FENÊTRE GLISSANTE D'UNE HEURE (mesuré le
 * 14/09/2026 : ~20 appels, puis 429 avec `Retry-After: 1493`) : 10 appels par run, séries et fascicules
 * confondus, une requête par seconde, `OUTBOUND_USER_AGENT`, et le run
 * s'arrête net au premier 429 — le prochain reprend là où la file en est.
 * Panne ≠ absence : une série qui ne répond pas n'est pas datée (elle repasse
 * en tête de file — un 5xx persistant sur UNE série coûte donc un appel par
 * run, pas quinze : accepté, review #311) ; une série disparue chez GCD (404)
 * est journalisée, datée, jamais supprimée ; aucune réponse sans que ce soit
 * le quota = run rouge (Cloudflare qui refuse le runner, panne). Le quota est
 * par IP, et les runners GitHub partagent les leurs : un quota consommé avant
 * toute réponse est annoté (`::warning::`) pour rester visible sans rougir.
 *
 * Usage :
 *   npm run series:gcd-live              → run réel
 *   npm run series:gcd-live -- --dry-run → compte sans écrire
 * Env : NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Toutes les heures
 * en CI (series-gcd-live.yml) et à la main.
 */

import { setTimeout as sleep } from "node:timers/promises";
import { createGcdLiveProvider, GcdQuotaError, type GcdLiveIssue } from "@/lib/resolution/providers/gcd-live";
import type { Database } from "@/lib/supabase/database.types";
import { createAdminClientFromEnv, isDryRun } from "./lib/env.mjs";
import {
  LIVE_CALLS_PER_RUN,
  LIVE_ISSUES_PER_SERIES,
  LIVE_POLITENESS_DELAY_MS,
  LIVE_RUN_BUDGET_MS,
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

// Au plus un appel par série : la file est bornée au budget, les fascicules le partagent.
const targets = selectLiveTargets(known, new Date(), LIVE_CALLS_PER_RUN);
console.log(`${known.length} séries GCD reliées, ${targets.length} en file ce run (${LIVE_CALLS_PER_RUN} appels)${dryRun ? " (dry-run)" : ""}`);

const counts: LiveRunCounts = { targets: targets.length, calls: 0, answered: 0, updated: 0, issuesAdded: 0, gone: 0, quotaHit: false, networkErrors: 0, infraErrors: 0 };
const startedAt = Date.now();
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

/** Un appel à l'API, compté ; `undefined` = pas de réponse (quota, panne) — l'appelant décide. */
async function call<T>(label: string, request: () => Promise<T>): Promise<T | undefined> {
  counts.calls += 1;
  try {
    return await request();
  } catch (error) {
    if (error instanceof GcdQuotaError) {
      counts.quotaHit = true;
      console.warn(`  ${label} : quota horaire atteint (429${error.retryAfterSeconds === null ? "" : `, Retry-After ${error.retryAfterSeconds} s`}) — le run s'arrête, le prochain reprend`);
    } else {
      counts.networkErrors += 1;
      console.error(`  ${label} : ${error instanceof Error ? error.message : String(error)}`);
    }
    return undefined;
  } finally {
    await sleep(LIVE_POLITENESS_DELAY_MS);
  }
}

for (const target of targets) {
  if (counts.quotaHit || counts.calls >= LIVE_CALLS_PER_RUN) break;
  // Le budget de temps : on s'arrête proprement, le bilan sort, le reste repasse (déjà en tête de file).
  if (Date.now() - startedAt > LIVE_RUN_BUDGET_MS) {
    stoppedByBudget += 1;
    continue;
  }
  const label = `« ${target.name ?? "?"} » #${target.gcdId}`;

  const live = await call(label, () => gcd.getSeries(target.gcdId));
  if (live === undefined) continue;
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

  // 3. Les fascicules que le dump n'a pas — l'existence se vérifie par gcd_id,
  // jamais par série : un fascicule déplacé côté GCD, ou chez nous sans
  // series_id, ne doit pas revenir en double (rien en base ne l'interdit —
  // review #311). Par paquets : une série VO peut compter 1 000 fascicules.
  const existingIds = new Set<number>();
  for (let index = 0; index < live.issueIds.length; index += 200) {
    const { data, error } = await admin.from("gcd_issues").select("gcd_id").in("gcd_id", live.issueIds.slice(index, index + 200));
    if (error) throw new Error(`gcd_issues : ${error.message}`);
    for (const row of data) existingIds.add(row.gcd_id);
  }
  const missingIds = live.issueIds.filter((id) => !existingIds.has(id)).slice(0, LIVE_ISSUES_PER_SERIES);

  const rows: IssueInsert[] = [];
  for (const issueId of missingIds) {
    if (counts.quotaHit || counts.calls >= LIVE_CALLS_PER_RUN) break;
    const issue = await call(`${label} fascicule ${issueId}`, () => gcd.getIssue(issueId));
    if (issue) rows.push(...issueRows(issue, target.gcdId));
  }

  const changes = Object.entries(patch).map(([key, value]) => `${key} → ${value}`);
  console.log(
    `  ${label} : ${live.issueCount} fascicules, dernier ${live.lastNumber ?? "?"}, fin ${live.yearEnded ?? "—"}` +
      (changes.length > 0 ? ` | ${changes.join(", ")}` : "") +
      (rows.length > 0 ? ` | +${rows.length} ligne${rows.length > 1 ? "s" : ""} (${rows.map((row) => row.number ?? "?").join(", ")})` : "") +
      (missingIds.length > rows.length ? ` | ${missingIds.length - rows.length} fascicule(s) au prochain run` : ""),
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
console.log(`  appels : ${counts.calls} · séries relues : ${counts.answered} sur ${counts.targets} en file · mises à jour : ${counts.updated} · fascicules ajoutés : ${counts.issuesAdded}`);
console.log(`  disparues chez GCD : ${counts.gone} · erreurs réseau : ${counts.networkErrors} · erreurs de notre côté : ${counts.infraErrors}${counts.quotaHit ? " · quota horaire atteint" : ""}`);
if (stoppedByBudget > 0) console.log(`  budget de temps atteint : ${stoppedByBudget} séries repassent au prochain run`);
// Famine silencieuse (review #311) : le quota par IP peut être consommé par d'autres sur l'IP du runner.
if (counts.quotaHit && counts.answered === 0 && counts.targets > 0) {
  console.warn("::warning title=GCD en direct::Quota horaire de comics.org déjà consommé avant toute réponse — si ça se répète à chaque run, l'IP du runner est saturée (rien n'a été relu).");
}
console.log(dryRun ? "\nDry-run : rien n'a été écrit." : "\nÉcrit — la synchronisation des faits (series:gcd-facts) suit.");
process.exit(liveRunExitCode(counts));
