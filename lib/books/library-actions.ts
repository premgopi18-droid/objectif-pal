"use server";

import { revalidatePath } from "next/cache";
import { GENERIC_ERROR_MESSAGE } from "@/lib/books/errors";
import type { JournalActionResult } from "@/lib/books/journal-actions";
import { getSessionOrError } from "@/lib/supabase/server";
import type { BookCategory } from "@/lib/scoring/types";
import {
  isValidCategory,
  prepareBookEdit,
  UNKNOWN_CATEGORY_MESSAGE,
  type BookEditInput,
  type BookEditPayload,
} from "@/lib/books/book-edit";
import type { SeriesAlignProposal } from "@/lib/books/series-align";

/**
 * « Retirer de la bibliothèque » (issue #49) — suppression douce du LIVRE
 * SEUL, pas de cascade : ses lectures et achats restent intacts en base mais
 * disparaissent de toutes les vues, car chaque surface filtre (ou part de)
 * `books.deleted_at` — le bilan le faisait déjà, le journal l'a rejoint avec
 * cette issue. 100 % réversible : RESCANNER le livre le ressuscite avec tout
 * son historique (résurrection #10, `mergeBookFieldsOnRescan`), photo de
 * couverture comprise (l'objet Storage n'est pas touché — rien n'est jamais
 * effacé, specs §7).
 */
export async function softDeleteBook(bookId: string): Promise<JournalActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };

  const { error, count } = await session.supabase
    .from("books")
    .update({ deleted_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", bookId)
    .eq("user_id", session.user.id)
    .is("deleted_at", null);
  if (error) {
    console.error("[library] softDeleteBook:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!count) return { ok: false, error: "Livre introuvable." };

  // La possession fabriquée d'un livre-erreur fait partie de l'erreur (#158,
  // vu en prod) : la laisser ACTIVE faisait dire « déjà possédé » au rescan
  // (résurrection #10 + garde de pile). Clôture DOUCE, comme tout (§7) —
  // jamais bloquante : le filet de dérivation tolère l'incohérence résiduelle.
  const { error: ownershipError } = await session.supabase
    .from("ownerships")
    .update({ deleted_at: new Date().toISOString() })
    .eq("book_id", bookId)
    .eq("user_id", session.user.id)
    .is("deleted_at", null);
  if (ownershipError) console.error("[library] softDeleteBook (possession):", ownershipError.message);

  // Le livre disparaît de PARTOUT : toutes les surfaces qui le montrent. Depuis
  // la refonte #64, la Pile est un volet de /bibliotheque et les Stats un volet
  // de /bilan — revalider ces deux routes couvre leurs deux volets.
  revalidatePath("/bibliotheque");
  revalidatePath("/journal");
  revalidatePath("/bilan");
  return { ok: true };
}

/**
 * Corriger la catégorie d'un livre (#101 lot C — la correction inline de la
 * rafale ; #100 la généralisera à toute la fiche).
 *
 * C'est le seul champ qu'on corrige en un tap, et pour une raison précise :
 * **la catégorie détermine les points** (§3). Une BD classée manga, c'est 2
 * points au lieu de 1 — donc un bilan d'antenne faux. Le rescan la corrigeait
 * déjà, mais un livre saisi à la main n'a pas de code-barres à rescanner, et
 * en rafale on ne s'arrête pas pour la vérifier.
 *
 * Conséquence ASSUMÉE : corriger la catégorie change les points des lectures
 * PASSÉES de ce livre — le score est toujours dérivé, jamais stocké (§7). Le
 * bilan corrigé est le bon : c'était une erreur de saisie.
 */
export async function updateBookCategory(bookId: string, category: BookCategory): Promise<JournalActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };

  // Validation serveur, par le prédicat PARTAGÉ : la valeur vient du client,
  // et elle pèse sur le score.
  if (!isValidCategory(category)) return { ok: false, error: UNKNOWN_CATEGORY_MESSAGE };

  return writeBookFields(session, bookId, { category }, "updateBookCategory");
}

/**
 * L'édition complète d'une fiche (issue #100) — le geste qui manquait aux
 * livres **saisis à la main** : sans code-barres, ils n'ont pas de rescan pour
 * se corriger, et leur fiche restait fausse pour toujours (§4.12).
 *
 * Ce qu'elle ne touche PAS, volontairement : `barcode_raw`, `barcode_type`,
 * `barcode_prefix`, `metadata_source`, `metadata_source_id`. C'est le pont de
 * re-résolution (§7) — le modifier à la main le casserait en silence. Le
 * rescan, lui, continue de rafraîchir les métadonnées (§4.2).
 *
 * La validation vit dans `prepareBookEdit` (pure, testée) : la même règle vaut
 * ici et à l'écran, sans être écrite deux fois.
 *
 * Depuis #257, le retour porte aussi la PROPOSITION d'alignement de série :
 * quand la fiche sauvée appartient à une série dont d'AUTRES tomes ont une
 * autre catégorie, on renvoie leur compte — c'est le serveur qui compte, pas
 * la Biblio affichée : elle ne montre que l'inventaire, et les emprunts lus
 * de la même série lui échappent. Un échec de CE comptage ne fait jamais
 * échouer l'enregistrement (la fiche est sauvée, la proposition est un bonus).
 */
export async function updateBookDetails(
  bookId: string,
  input: BookEditInput,
): Promise<{ ok: true; seriesAlign: SeriesAlignProposal | null } | { ok: false; error: string }> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };

  const prepared = prepareBookEdit(input);
  if (!prepared.ok) return { ok: false, error: prepared.error };

  const written = await writeBookFields(session, bookId, prepared.payload, "updateBookDetails");
  if (!written.ok) return written;

  return { ok: true, seriesAlign: await findSeriesAlignProposal(session, bookId, prepared.payload) };
}

/**
 * Le comptage de la divergence de série (#257) — les AUTRES livres de
 * l'utilisateur portant exactement le même `series_name` (la clé du lot,
 * comparaison stricte — la normalisation d'affichage ne s'applique pas ici)
 * avec une autre catégorie. `null` = rien à proposer.
 */
async function findSeriesAlignProposal(
  session: NonNullable<Awaited<ReturnType<typeof getSessionOrError>>>,
  bookId: string,
  payload: BookEditPayload,
): Promise<SeriesAlignProposal | null> {
  if (payload.series_name === null) return null;

  const { count, error } = await session.supabase
    .from("books")
    .select("id", { count: "exact", head: true })
    .eq("user_id", session.user.id)
    .eq("series_name", payload.series_name)
    .neq("id", bookId)
    .neq("category", payload.category)
    .is("deleted_at", null);
  if (error) {
    console.error("[library] findSeriesAlignProposal:", error.message);
    return null;
  }
  if (!count) return null;

  return { seriesName: payload.series_name, category: payload.category, divergentCount: count };
}

/**
 * Appliquer la catégorie à TOUTE la série (#257) — le lot implicite : pas de
 * cases à cocher, la série EST la sélection. UN seul UPDATE scopé user sur
 * les livres au même `series_name` et à la catégorie différente — le compte
 * RÉEL est renvoyé (entre la proposition et le tap, un autre onglet a pu
 * bouger), c'est lui que le client annonce.
 *
 * Les mois clos suivent tout seuls : le trigger `books_bump_fact_version`
 * couvre `update of category` (migration 20260815160000) → la version des
 * faits bouge → `syncMonthlyReports` rejoue les bilans matérialisés à la
 * prochaine visite du Bilan — les bilans comparés du cercle (§4.14) restent
 * justes sans job manuel.
 */
export async function applyCategoryToSeries(
  seriesName: string,
  category: BookCategory,
): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };

  if (!isValidCategory(category)) return { ok: false, error: UNKNOWN_CATEGORY_MESSAGE };
  const trimmedSeriesName = seriesName.trim();
  if (trimmedSeriesName === "") return { ok: false, error: "La série est introuvable." };

  const { error, count } = await session.supabase
    .from("books")
    .update({ category }, { count: "exact" })
    .eq("user_id", session.user.id)
    .eq("series_name", trimmedSeriesName)
    .neq("category", category)
    .is("deleted_at", null);
  if (error) {
    console.error("[library] applyCategoryToSeries:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }

  // Mêmes surfaces que writeBookFields : la catégorie change les points des
  // lectures passées de ces tomes (le score est dérivé, jamais stocké — §7).
  revalidatePath("/bibliotheque");
  revalidatePath("/journal");
  revalidatePath("/bilan");
  return { ok: true, updated: count ?? 0 };
}

/**
 * Le préfixe qui marque un `raise exception` SQL **destiné à l'écran**.
 *
 * Sans convention explicite, tout `raise exception` finirait affiché à
 * l'utilisateur — y compris celui qu'un futur contributeur ajouterait pour une
 * raison technique. On ne remonte donc QUE les messages qui se présentent, et
 * on retire le préfixe avant l'affichage.
 */
const SQL_USER_MESSAGE_PREFIX = "UX: ";
/** Le code PostgreSQL d'un `raise exception` sans `errcode` explicite. */
const POSTGRES_RAISE_EXCEPTION = "P0001";

/**
 * Un échec de RPC → le message à montrer. Tout ce qui n'est pas un refus
 * métier explicitement marqué part sur le message générique : une panne ne
 * doit jamais exposer d'interne (§8).
 */
function userFacingSqlError(code: string | undefined, message: string): string {
  if (code !== POSTGRES_RAISE_EXCEPTION || !message.includes(SQL_USER_MESSAGE_PREFIX)) {
    return GENERIC_ERROR_MESSAGE;
  }
  // PostgREST peut préfixer le message ; on repart du marqueur, pas du début.
  return message.slice(message.indexOf(SQL_USER_MESSAGE_PREFIX) + SQL_USER_MESSAGE_PREFIX.length).trim();
}

/**
 * Fusionner un doublon dans un livre conservé (issue #100, second volet).
 *
 * Tout le travail vit dans la fonction SQL `merge_books` — et c'est délibéré :
 * la fusion re-pointe des faits dans trois tables puis supprime un livre. À
 * moitié faite, elle laisserait des lectures rattachées à un livre effacé ou
 * deux possessions actives violant l'index unique. En SQL, le corps entier est
 * **une transaction** : tout ou rien.
 *
 * La fonction vérifie elle-même que les deux livres appartiennent à l'appelant
 * (elle est `security definer`, donc hors RLS) et refuse deux codes-barres
 * différents. Les messages qu'elle lève sont écrits pour être montrés.
 */
export async function mergeBooks(keepBookId: string, mergeBookId: string): Promise<JournalActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };

  const { error } = await session.supabase.rpc("merge_books", {
    keep_book_id: keepBookId,
    merge_book_id: mergeBookId,
  });
  if (error) {
    console.error("[library] mergeBooks:", error.message);
    return { ok: false, error: userFacingSqlError(error.code, error.message) };
  }

  revalidatePath("/bibliotheque");
  revalidatePath("/journal");
  revalidatePath("/bilan");
  return { ok: true };
}

/**
 * L'écriture partagée des deux gestes ci-dessus : mêmes gardes (le livre
 * t'appartient et n'est pas supprimé), mêmes revalidations.
 *
 * ⚠️ Les revalidations couvrent le **bilan et le journal**, pas seulement la
 * Biblio : changer une catégorie change les points des lectures PASSÉES de ce
 * livre (le score est toujours dérivé, jamais stocké — §7). C'est assumé : le
 * bilan corrigé est le bon, c'était une erreur de saisie.
 */
async function writeBookFields(
  session: NonNullable<Awaited<ReturnType<typeof getSessionOrError>>>,
  bookId: string,
  fields: Partial<BookEditPayload>,
  label: string,
): Promise<JournalActionResult> {
  const { error, count } = await session.supabase
    .from("books")
    .update(fields, { count: "exact" })
    .eq("id", bookId)
    .eq("user_id", session.user.id)
    .is("deleted_at", null);
  if (error) {
    console.error(`[library] ${label}:`, error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!count) return { ok: false, error: "Livre introuvable." };

  revalidatePath("/bibliotheque");
  revalidatePath("/journal");
  revalidatePath("/bilan");
  return { ok: true };
}
