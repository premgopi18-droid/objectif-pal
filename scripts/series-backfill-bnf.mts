/**
 * Rattrapage des livres BnF sans série (lot 0 de l'epic séries #289, ticket
 * #290, specs §4.17 décision 12).
 *
 * Avant le lot 0, le provider BnF lisait le Dublin Core et perdait la série
 * de la plupart des livres VF (mesuré : 655 livres BnF en prod, 82 avec une
 * série). Ce script relit UNE fois chaque ISBN concerné en UNIMARC et comble
 * `series_name` / `issue_number` — SEULEMENT quand ils sont vides (la règle
 * du rescan : `planSeriesBackfill`, testé), pour tous les comptes. Titre,
 * auteurs, couverture : jamais touchés.
 *
 * Le cache partagé (`barcode_cache`) est comblé de la même façon, colonne par
 * colonne : PAS un upsert de l'entrée entière, qui écraserait la couverture
 * cachée par la BnF (qui n'en a pas). Les identifiants de série (461 $0) y
 * entrent aussi : le lot A s'en servira pour relier sans repayer les appels.
 *
 * Politesse (#190) : appels séquentiels, UA identifiant, un ISBN partagé par
 * plusieurs comptes n'est demandé qu'une fois.
 *
 * Usage :
 *   npm run series:backfill-bnf            → DRY-RUN : compte sans rien écrire
 *   npm run series:backfill-bnf -- --apply → écrit
 * (node --conditions=react-server --import tsx : voir package.json)
 *
 * Env : NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (.env.local en
 * local). One-shot, lancé par Prem après le merge — à supprimer une fois joué
 * si le lot A n'en a plus besoin.
 */

import { setTimeout as sleep } from "node:timers/promises";
import { planSeriesBackfill, type SeriesBackfillPlan } from "@/lib/books/series-backfill";
import { createBnfProvider, type BnfRecord } from "@/lib/resolution/providers/bnf";
import { fetchAllRows } from "@/lib/supabase/pagination";
import { createAdminClientFromEnv } from "./lib/env.mjs";

const apply = process.argv.includes("--apply");
const { admin } = createAdminClientFromEnv();
const bnf = createBnfProvider();

const POLITENESS_DELAY_MS = 150;

type BookRow = { id: string; user_id: string; isbn: string; series_name: string | null; issue_number: string | null };

// Tous les comptes, volontairement (§4.17-12) : la sélection ne cible que des
// champs vides, l'écriture ne remplit que des champs vides — rien n'est écrasé.
const books = (await fetchAllRows<BookRow>(async (from, to) => {
  const { data, error } = await admin
    .from("books")
    .select("id, user_id, isbn, series_name, issue_number")
    .eq("metadata_source", "bnf")
    .is("series_name", null)
    .is("deleted_at", null)
    .not("isbn", "is", null)
    .order("isbn")
    .order("id")
    .range(from, to);
  if (error) throw new Error(`books : ${error.message}`);
  return data as BookRow[];
})).filter((book): book is BookRow => book.isbn !== null);

const booksByIsbn = new Map<string, BookRow[]>();
for (const book of books) booksByIsbn.set(book.isbn, [...(booksByIsbn.get(book.isbn) ?? []), book]);

console.log(`${books.length} livres BnF sans série, ${booksByIsbn.size} ISBN distincts${apply ? "" : " (dry-run)"}`);

const outcomes: Record<SeriesBackfillPlan["outcome"] | "error", number> = {
  fill: 0,
  "no-series": 0,
  "no-record": 0,
  "already-filled": 0,
  error: 0,
};
const filledByUser = new Map<string, number>();

for (const [isbn, rows] of booksByIsbn) {
  let record: BnfRecord | null;
  try {
    record = await bnf.resolveIsbn(isbn);
  } catch (error) {
    outcomes.error += 1;
    console.error(`  ${isbn} : ${error instanceof Error ? error.message : String(error)}`);
    await sleep(POLITENESS_DELAY_MS);
    continue;
  }

  for (const book of rows) {
    const plan = planSeriesBackfill(book, record);
    outcomes[plan.outcome] += 1;
    if (plan.outcome !== "fill") continue;

    filledByUser.set(book.user_id, (filledByUser.get(book.user_id) ?? 0) + 1);
    console.log(`  ${isbn} → « ${plan.update.series_name} »${plan.update.issue_number ? ` #${plan.update.issue_number}` : ""}`);
    if (!apply) continue;

    // `series_name is null` répété à l'écriture : si le propriétaire a édité
    // la fiche entre la lecture et l'écriture, sa saisie gagne.
    // Un échec d'écriture ne fait pas tomber le run (review #294) : compté,
    // loggé, et le code de sortie le dira — les ISBN relus ne sont pas repayés.
    const { error } = await admin.from("books").update(plan.update).eq("id", book.id).is("series_name", null);
    if (error) {
      outcomes.error += 1;
      console.error(`  books ${book.id} : ${error.message}`);
    }
  }

  // Le cache partagé, colonne par colonne — et seulement s'il a lui aussi la
  // série vide (une saisie manuelle #55 qui l'aurait comblée reste intacte).
  if (apply && record?.seriesName) {
    const { error } = await admin
      .from("barcode_cache")
      .update({
        series_name: record.seriesName,
        issue_number: record.issueNumber,
        series_external_source: record.bnfSeriesId ? "bnf" : null,
        series_external_id: record.bnfSeriesId,
      })
      .eq("barcode", isbn)
      .is("series_name", null);
    if (error) {
      outcomes.error += 1;
      console.error(`  barcode_cache ${isbn} : ${error.message}`);
    }
  }

  await sleep(POLITENESS_DELAY_MS);
}

console.log("\nBilan :");
console.log(`  comblés : ${outcomes.fill}`);
console.log(`  notice sans série (one-shot, roman) : ${outcomes["no-series"]}`);
console.log(`  ISBN inconnu de la BnF : ${outcomes["no-record"]}`);
console.log(`  erreurs (réseau ou écriture) : ${outcomes.error}`);
console.log("  par compte (user_id abrégé) :");
for (const [userId, count] of filledByUser) console.log(`    ${userId.slice(0, 8)}… : ${count}`);
console.log(apply ? "\nÉcrit." : "\nDry-run : rien n'a été écrit. Relancer avec --apply pour écrire.");
// Un run avec des erreurs n'est pas un run réussi — relancer (idempotent :
// seuls les champs encore vides sont comblés).
if (outcomes.error > 0) process.exit(1);
