/**
 * Le fait de série depuis GCD (décision du 14/09/2026, suite de #299, §4.17-4).
 *
 * Pour chaque série reliée à GCD SANS déclaration humaine, la RPC
 * `sync_series_facts_from_gcd` pose le fait : « parution en cours » si l'une
 * de ses séries GCD est courante, sinon le numéro du dernier fascicule comme
 * total. Source `gcd`, auteur « GCD », modifiable d'un tap — une déclaration
 * humaine n'est jamais touchée, une déclaration GCD suit GCD (au prochain dump,
 * une série qui se clôt passe de « en cours » à son total).
 *
 * Tout le travail est en SQL (une transaction) ; ici on lance et on compte.
 * Chaque nuit après le plancher BnF (series.yml), et après chaque
 * rafraîchissement du dump (gcd:load).
 *
 * Usage : npm run series:gcd-facts
 * Env : NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */

import { createAdminClientFromEnv } from "./lib/env.mjs";

const { admin } = createAdminClientFromEnv();

const { data, error } = await admin.rpc("sync_series_facts_from_gcd");
if (error) {
  console.error(`sync_series_facts_from_gcd : ${error.message}`);
  process.exit(1);
}
const [counts] = data;
console.log("Faits de série depuis GCD :");
console.log(`  totaux déclarés (série close, dernier numéro) : ${counts?.declared_total ?? 0}`);
console.log(`  parutions en cours déclarées : ${counts?.declared_ongoing ?? 0}`);
console.log(`  inchangées (déjà à jour, ou GCD sans dernier numéro numérique) : ${counts?.unchanged ?? 0}`);
