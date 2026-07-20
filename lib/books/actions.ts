"use server";

import { revalidatePath } from "next/cache";
import { getSessionOrError, type createServerSupabaseClient } from "@/lib/supabase/server";
import { isValidIsoDate } from "@/lib/dates";
import { GENERIC_ERROR_MESSAGE } from "@/lib/books/errors";
import { getReadingInProgressError } from "@/lib/books/reading-guards";
import { mergeBookFieldsOnRescan } from "@/lib/books/book-merge";
import { manualEntryToCacheEntry } from "@/lib/books/manual-cache";
import { isBookInPile } from "@/lib/books/pile-guard";
import { createCacheProvider } from "@/lib/resolution/providers/cache";
import type { JournalActionResult } from "@/lib/books/journal-actions";
import type { BookCategory } from "@/lib/scoring/types";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Les gestes du scan — specs §4.1 : le scan RÉSOUT un livre, ce qu'on en fait
 * est une ACTION choisie après. « Je commence » crée une lecture, « je
 * l'achète » crée un achat, « je possède » déclare une possession sans achat
 * et « je l'ai déjà lu » enregistre une lecture passée (#101) ; tous passent
 * par le même livre (findOrCreateBook), jamais l'un par l'autre.
 *
 * Les deux gestes de #101 sont ceux de l'étagère d'AVANT l'app : ils ne
 * touchent jamais au barème. Une possession n'est pas un achat (pas de malus),
 * et une lecture sans date de fin ne crédite aucun mois (les points sont datés
 * par `finished_at`, §3 règle 1).
 *
 * Toutes les écritures passent par le client SESSION (cookies, RLS active) —
 * jamais le service role pour des données utilisateur (specs §7).
 */

/** Ce que la feuille de scan (ou la saisie manuelle) envoie — catégorie CORRIGÉE incluse. */
export type BookInput = {
  title: string;
  seriesName: string | null;
  issueNumber: string | null;
  authors: string | null;
  publisher: string | null;
  pageCount: number | null;
  coverUrl: string | null;
  /** La catégorie affichée au moment du geste — la correction de l'utilisateur fait foi. */
  category: BookCategory;
  barcodeRaw: string | null;
  barcodeType: "isbn" | "upc" | null;
  isbn: string | null;
  metadataSource: "gcd" | "bnf" | "google_books" | "metron" | "manual";
  metadataSourceId: string | null;
};

export type ScanActionResult =
  // bookId : permet de proposer la photo de couverture juste après (issue #33).
  | {
      ok: true;
      bookId: string;
      bookAlreadyExisted: boolean;
      isRereading?: boolean;
      purchaseId?: string;
      /** L'id de la possession déclarée — ce qu'annule « je ne le possède plus » (#101). */
      ownershipId?: string;
    }
  | { ok: false; error: string };

const BARCODE_PREFIX_LENGTH = 12;

/**
 * Le refus de `recordOwnership` quand le livre est déjà là. Constante parce
 * qu'un appelant a besoin de le DISTINGUER d'un vrai échec (cf.
 * `recordOwnedPastReading`) — comparer des littéraux se serait cassé au
 * premier ajustement de formulation.
 */
const ALREADY_OWNED_MESSAGE = "Ce livre est déjà dans ta bibliothèque.";

/**
 * La date vient TOUJOURS du client (la date locale de l'appareil, modifiable) :
 * le serveur tourne en UTC, son « aujourd'hui » peut être hier ou demain à
 * Paris — exactement le bug de bilan que les specs §7 interdisent.
 */
function validateDate(date: string): string | null {
  return isValidIsoDate(date) ? date : null;
}

function validateBook(input: BookInput): string | null {
  if (!input.title?.trim()) return "Le titre est obligatoire.";
  if (input.pageCount !== null && (!Number.isInteger(input.pageCount) || input.pageCount <= 0)) {
    return "Le nombre de pages est invalide.";
  }
  return null;
}

/**
 * Un livre par code-barres et par utilisateur (specs §4.2) : le rescan
 * réutilise l'existant, et un livre supprimé en douceur est ressuscité
 * plutôt que dupliqué (la contrainte d'unicité couvre aussi les supprimés).
 *
 * Règle du rescan : l'utilisateur vient de VOIR (et éventuellement corriger)
 * la feuille — son titre et sa catégorie font foi, ils sont TOUJOURS
 * appliqués (la catégorie détermine les points au barème, et il n'existe
 * aucune autre UI pour la corriger). Les autres métadonnées ne font que
 * COMBLER les trous : une valeur non-null en base n'est jamais écrasée.
 */
async function findOrCreateBook(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  input: BookInput,
): Promise<{ bookId: string; alreadyExisted: boolean } | { error: string }> {
  if (input.barcodeRaw) {
    const { data: existing, error } = await supabase
      .from("books")
      .select("id, deleted_at, series_name, issue_number, authors, publisher, page_count, isbn, cover_url")
      .eq("user_id", userId)
      .eq("barcode_raw", input.barcodeRaw)
      .maybeSingle();
    if (error) {
      console.error("[books] findOrCreateBook:", error.message);
      return { error: GENERIC_ERROR_MESSAGE };
    }

    if (existing) {
      // La décision de fusion vit dans une fonction pure, testée (book-merge.ts).
      // metadata_source et metadata_source_id restent ceux de la création : la
      // paire doit désigner le même référentiel, et la source (NOT NULL) n'est
      // jamais « comblable » — on ne touche donc pas à l'id non plus.
      const { error: updateError } = await supabase
        .from("books")
        .update(mergeBookFieldsOnRescan(existing, input))
        .eq("id", existing.id);
      if (updateError) {
        console.error("[books] findOrCreateBook:", updateError.message);
        return { error: GENERIC_ERROR_MESSAGE };
      }
      return { bookId: existing.id, alreadyExisted: true };
    }
  }

  const { data: created, error: insertError } = await supabase
    .from("books")
    .insert({
      user_id: userId,
      title: input.title.trim(),
      series_name: input.seriesName,
      issue_number: input.issueNumber,
      authors: input.authors,
      publisher: input.publisher,
      page_count: input.pageCount,
      category: input.category,
      barcode_raw: input.barcodeRaw,
      barcode_type: input.barcodeType,
      barcode_prefix: input.barcodeRaw ? input.barcodeRaw.slice(0, BARCODE_PREFIX_LENGTH) : null,
      isbn: input.isbn,
      cover_url: input.coverUrl,
      metadata_source: input.metadataSource,
      metadata_source_id: input.metadataSourceId,
    })
    .select("id")
    .single();
  if (insertError) {
    console.error("[books] findOrCreateBook:", insertError.message);
    return { error: GENERIC_ERROR_MESSAGE };
  }

  return { bookId: created.id, alreadyExisted: false };
}

/**
 * Une saisie manuelle rattachée à un code-barres part dans `barcode_cache`
 * (issue #55) — APRÈS la création du livre, jamais bloquant : le geste de
 * l'utilisateur ne doit pas échouer parce que le cache partagé a toussé.
 * Une entrée d'une VRAIE source (BnF, Google Books…) n'est jamais écrasée :
 * elle peut exister si la cascade a abouti pendant que l'utilisateur sautait
 * vers la saisie manuelle — la source référencée reste meilleure que la main.
 */
async function cacheManualEntry(input: BookInput): Promise<void> {
  const entry = manualEntryToCacheEntry(input);
  if (!entry) return;
  try {
    const cache = createCacheProvider();
    const existing = await cache.get(entry.barcode);
    if (existing && existing.source !== "manual") return;
    await cache.set(entry);
  } catch (error) {
    console.error("[books] cacheManualEntry:", error instanceof Error ? error.message : String(error));
  }
}

/**
 * Les faits dont le garde de pile a besoin — achats, lectures ET possession
 * déclarée (#101), chargés en un aller-retour. Écrit une seule fois : les
 * gestes qui doivent décider « ce livre est-il déjà dans la pile ? » passent
 * tous par ici, pour poser exactement la même question que la vue PAL.
 */
type Tables = Database["public"]["Tables"];
type PileFacts = {
  purchases: Pick<Tables["purchases"]["Row"], "purchased_at" | "deleted_at">[];
  readings: Pick<Tables["readings"]["Row"], "status" | "finished_at" | "deleted_at">[];
  ownerships: Pick<Tables["ownerships"]["Row"], "id" | "owned_since" | "disposed_at" | "deleted_at">[];
};

async function loadPileFacts(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  bookId: string,
): Promise<PileFacts | { error: string }> {
  const [purchases, readings, ownerships] = await Promise.all([
    supabase.from("purchases").select("purchased_at, deleted_at").eq("user_id", userId).eq("book_id", bookId),
    supabase.from("readings").select("status, finished_at, deleted_at").eq("user_id", userId).eq("book_id", bookId),
    supabase
      .from("ownerships")
      .select("id, owned_since, disposed_at, deleted_at")
      .eq("user_id", userId)
      .eq("book_id", bookId),
  ]);
  const failure = purchases.error ?? readings.error ?? ownerships.error;
  if (failure) {
    console.error("[books] loadPileFacts:", failure.message);
    return { error: GENERIC_ERROR_MESSAGE };
  }
  return {
    purchases: purchases.data ?? [],
    readings: readings.data ?? [],
    ownerships: ownerships.data ?? [],
  };
}

/** « Je commence » — crée une lecture ; 0 point pour l'instant (specs §4.1). */
export async function startReading(input: BookInput, startedAt: string): Promise<ScanActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };
  const { supabase, user } = session;

  const invalid = validateBook(input);
  if (invalid) return { ok: false, error: invalid };
  const date = validateDate(startedAt);
  if (!date) return { ok: false, error: "Date de début invalide." };

  const book = await findOrCreateBook(supabase, user.id, input);
  if ("error" in book) return { ok: false, error: book.error };
  await cacheManualEntry(input);

  // Les deux vérifications sont indépendantes (le garde « déjà en cours » et
  // le décompte « déjà terminé » pour signaler la relecture) : en parallèle,
  // un aller-retour Supabase au lieu de deux.
  const [inProgressError, { count: finishedCount, error: finishedError }] = await Promise.all([
    getReadingInProgressError(supabase, user.id, book.bookId),
    // Relire = une NOUVELLE lecture du même livre (specs §4.2) — permise, signalée.
    supabase
      .from("readings")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("book_id", book.bookId)
      .eq("status", "finished")
      .is("deleted_at", null),
  ]);
  if (inProgressError) return { ok: false, error: inProgressError };
  if (finishedError) {
    console.error("[books] startReading:", finishedError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }

  // Le trigger en base écrit reading_events tout seul, atomiquement.
  const { error: readingError } = await supabase.from("readings").insert({
    user_id: user.id,
    book_id: book.bookId,
    status: "reading",
    started_at: date,
  });
  if (readingError) {
    console.error("[books] startReading:", readingError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }

  revalidatePath("/journal");
  return { ok: true, bookId: book.bookId, bookAlreadyExisted: book.alreadyExisted, isRereading: (finishedCount ?? 0) > 0 };
}

/** « Je l'achète » — crée un achat : −1 immédiat, effaçable (specs §4.1). */
export async function recordPurchase(input: BookInput, purchasedAt: string): Promise<ScanActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };
  const { supabase, user } = session;

  const invalid = validateBook(input);
  if (invalid) return { ok: false, error: invalid };
  const date = validateDate(purchasedAt);
  if (!date) return { ok: false, error: "Date d'achat invalide." };

  const book = await findOrCreateBook(supabase, user.id, input);
  if ("error" in book) return { ok: false, error: book.error };
  await cacheManualEntry(input);

  // Garde du doublon (specs §4.6, §3.3) : un livre DÉJÀ dans la pile ne se
  // rachète pas — ce serait un −2 silencieux. Racheter un déjà-lu reste permis
  // (il n'entre pas dans la pile). On charge les achats + fins du livre et on
  // délègue la décision au prédicat pur, cohérent avec la vue PAL.
  const pileFacts = await loadPileFacts(supabase, user.id, book.bookId);
  if ("error" in pileFacts) return { ok: false, error: pileFacts.error };
  if (isBookInPile(pileFacts.purchases, pileFacts.readings, pileFacts.ownerships)) {
    return { ok: false, error: "Ce livre est déjà dans ta PAL." };
  }

  const { data: inserted, error: purchaseError } = await supabase
    .from("purchases")
    .insert({
      user_id: user.id,
      book_id: book.bookId,
      purchased_at: date,
    })
    .select("id")
    .single();
  if (purchaseError) {
    console.error("[books] recordPurchase:", purchaseError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }

  // Racheter ROUVRE une possession close (#117) — même principe que
  // `recordOwnership` (« je l'avais donné, je le rachète ») : sans ça, la
  // cession primait dans la dérivation et le livre racheté manquait à la pile.
  // APRÈS l'achat, volontairement : réouvrir sans achat inscrit remettrait le
  // livre en pile sur une écriture à moitié faite. Échec absorbé (log seul) :
  // le filet de `derivePileStatus` dérive juste même si cette ligne reste close.
  const closedOwnership = pileFacts.ownerships.find(
    (ownership) => ownership.deleted_at === null && ownership.disposed_at !== null,
  );
  if (closedOwnership) {
    const { error: reopenError } = await supabase
      .from("ownerships")
      .update({ disposed_at: null })
      .eq("id", closedOwnership.id)
      .eq("user_id", user.id);
    if (reopenError) console.error("[books] recordPurchase (réouverture):", reopenError.message);
  }

  revalidatePath("/journal");
  revalidatePath("/bilan");
  revalidatePath("/bibliotheque"); // l'achat fait entrer le livre dans la pile (volet Pile)
  // L'id remonte pour permettre l'annulation immédiate juste après le scan.
  return { ok: true, bookId: book.bookId, bookAlreadyExisted: book.alreadyExisted, purchaseId: inserted.id };
}

/** Les vues que la possession et les lectures passées font bouger. */
function revalidateLibrarySurfaces(): void {
  revalidatePath("/bibliotheque");
  revalidatePath("/journal");
  revalidatePath("/bilan"); // la PAL des stats vit sous /bilan?vue=stats
}

/**
 * « Je possède » — déclare la possession SANS achat (#101, specs §1 et §12).
 *
 * C'est le geste de l'étagère d'avant l'app. **Aucun malus** : il ne crée pas
 * d'achat, et rien de ce qu'il écrit n'atteint le moteur de score. `ownedSince`
 * est FACULTATIVE — sans elle, le livre compte dans le stock de la PAL sans
 * peser sur les flux du mois (on n'invente pas une date d'acquisition).
 */
export async function recordOwnership(input: BookInput, ownedSince: string | null): Promise<ScanActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };
  const { supabase, user } = session;

  const invalid = validateBook(input);
  if (invalid) return { ok: false, error: invalid };
  if (ownedSince !== null && !isValidIsoDate(ownedSince)) {
    return { ok: false, error: "Date d'acquisition invalide." };
  }

  const book = await findOrCreateBook(supabase, user.id, input);
  if ("error" in book) return { ok: false, error: book.error };
  await cacheManualEntry(input);

  const facts = await loadPileFacts(supabase, user.id, book.bookId);
  if ("error" in facts) return { ok: false, error: facts.error };

  // Déjà possédé et pas encore lu : le redéclarer ne veut rien dire. Même
  // garde que « je l'achète », même message d'esprit (§4.6).
  if (isBookInPile(facts.purchases, facts.readings, facts.ownerships)) {
    return { ok: false, error: ALREADY_OWNED_MESSAGE };
  }

  // La base ne tolère qu'UNE déclaration active par livre (index unique
  // partiel) : on ressuscite celle qui existe plutôt que d'en insérer une
  // seconde — c'est le cas « je l'avais donné, je le rachète ».
  const existing = facts.ownerships.find((ownership) => ownership.deleted_at === null);
  if (existing) {
    const { error } = await supabase
      .from("ownerships")
      .update({ owned_since: ownedSince, disposed_at: null })
      .eq("id", existing.id)
      .eq("user_id", user.id);
    if (error) {
      console.error("[books] recordOwnership:", error.message);
      return { ok: false, error: GENERIC_ERROR_MESSAGE };
    }
    revalidateLibrarySurfaces();
    return {
      ok: true,
      bookId: book.bookId,
      bookAlreadyExisted: book.alreadyExisted,
      ownershipId: existing.id,
    };
  }

  const { data: inserted, error } = await supabase
    .from("ownerships")
    .insert({ user_id: user.id, book_id: book.bookId, owned_since: ownedSince })
    .select("id")
    .single();
  if (error) {
    console.error("[books] recordOwnership:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }

  revalidateLibrarySurfaces();
  return { ok: true, bookId: book.bookId, bookAlreadyExisted: book.alreadyExisted, ownershipId: inserted.id };
}

/**
 * « Je ne le possède plus » — don, revente, perte (#101).
 *
 * À ne pas confondre avec « Retirer de la bibliothèque » (§4.12), qui masque le
 * livre et TOUTES ses traces : ici le livre sort de la pile et de la biblio
 * possédée, mais **ses lectures et ses points restent au bilan**. L'achat n'est
 * jamais touché non plus — son malus historique est acquis, le mois est clos.
 *
 * Sur un livre entré par un ACHAT, il n'y a pas encore de ligne de possession :
 * on en crée une, sans date d'acquisition (elle est portée par l'achat), avec
 * la seule date qui compte ici — celle de la sortie.
 */
export async function endOwnership(bookId: string, disposedAt: string): Promise<JournalActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };
  const { supabase, user } = session;

  if (!isValidIsoDate(disposedAt)) return { ok: false, error: "Date de sortie invalide." };

  const facts = await loadPileFacts(supabase, user.id, bookId);
  if ("error" in facts) return { ok: false, error: facts.error };

  const existing = facts.ownerships.find((ownership) => ownership.deleted_at === null) ?? null;
  const hasActivePurchase = facts.purchases.some((purchase) => purchase.deleted_at === null);

  // On ne sort pas d'une possession qui n'existe pas. Sans cette garde, insérer
  // une ligne « possédé à une date inconnue, puis donné » sur un livre jamais
  // possédé fabriquerait une SORTIE de pile datée pour un livre qui n'y est
  // jamais entré : la taille resterait juste, mais le solde du mois afficherait
  // une sortie fantôme — un chiffre faux, et lu à l'antenne.
  const isOwned = existing !== null ? existing.disposed_at === null : hasActivePurchase;
  if (!isOwned) return { ok: false, error: "Ce livre n'est pas dans ta bibliothèque." };

  // La sortie ne peut pas précéder l'acquisition (contrainte en base — le
  // message est plus clair ici).
  if (existing && existing.owned_since !== null && disposedAt < existing.owned_since) {
    return { ok: false, error: "La date de sortie ne peut pas précéder l'acquisition." };
  }

  const { error } = existing
    ? await supabase
        .from("ownerships")
        .update({ disposed_at: disposedAt })
        .eq("id", existing.id)
        .eq("user_id", user.id)
    : await supabase
        .from("ownerships")
        .insert({ user_id: user.id, book_id: bookId, owned_since: null, disposed_at: disposedAt });
  if (error) {
    console.error("[books] endOwnership:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }

  revalidateLibrarySurfaces();
  return { ok: true };
}

/**
 * « Je l'ai déjà lu » — une lecture PASSÉE, en un geste (#101).
 *
 * `finishedAt` est FACULTATIVE, et c'est tout l'intérêt :
 *  - renseignée → les points tombent dans le bilan de ce mois-là, **déjà clos**
 *    (les dates sont librement saisissables, §4.2 — le mois courant n'est
 *    touché que si on saisit une date du mois courant, ce qui est voulu) ;
 *  - vide → la lecture n'appartient à aucun mois et ne crédite **rien**, nulle
 *    part. C'est un fait de bibliothèque, pas une lecture du jeu.
 *
 * Indépendant de la possession : un livre de médiathèque lu il y a deux ans est
 * « lu » sans être « possédé ».
 */
export async function recordPastReading(
  input: BookInput,
  finishedAt: string | null,
  details: { rating: number | null; comment: string | null } = { rating: null, comment: null },
): Promise<ScanActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };
  const { supabase, user } = session;

  const invalid = validateBook(input);
  if (invalid) return { ok: false, error: invalid };
  if (finishedAt !== null && !isValidIsoDate(finishedAt)) {
    return { ok: false, error: "Date de fin invalide." };
  }

  const book = await findOrCreateBook(supabase, user.id, input);
  if ("error" in book) return { ok: false, error: book.error };
  await cacheManualEntry(input);

  // Refus doux si une lecture est EN COURS : on ne pose pas une lecture
  // terminée par-dessus une lecture active — le geste juste est « Terminer »
  // depuis le journal (décision du 20/07/2026).
  const inProgressError = await getReadingInProgressError(supabase, user.id, book.bookId);
  if (inProgressError) return { ok: false, error: inProgressError };

  // Garde du doublon, comme les autres gestes en ont une. On refuse les deux
  // cas NON AMBIGUS, et eux seuls :
  //  - une lecture terminée sans date existe déjà → en redéclarer une
  //    n'ajoute aucune information ;
  //  - une lecture terminée à la MÊME date existe déjà → on ne finit pas deux
  //    fois le même livre le même jour. Sans cette seconde garde, rescanner un
  //    livre pendant une rafale datée créait une seconde lecture, comptée
  //    comme une relecture : **des points en double au bilan** (§3).
  // Une relecture à une AUTRE date reste légitime (§4.2 — relire est un fait
  // de plus, pas un doublon).
  const duplicateQuery = supabase
    .from("readings")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("book_id", book.bookId)
    .eq("status", "finished")
    .is("deleted_at", null);
  const { count, error: duplicateError } = await (finishedAt === null
    ? duplicateQuery.is("finished_at", null)
    : duplicateQuery.eq("finished_at", finishedAt));
  if (duplicateError) {
    console.error("[books] recordPastReading:", duplicateError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if ((count ?? 0) > 0) return { ok: false, error: "Ce livre est déjà marqué comme lu." };

  // `started_at` reste NULL : une lecture rétroactive n'a pas de début connu,
  // et on ne lui en invente pas un (la contrainte
  // `readings_undated_finish_has_no_start` s'appuie précisément là-dessus).
  // Le trigger en base écrit reading_events tout seul, atomiquement.
  const { error } = await supabase.from("readings").insert({
    user_id: user.id,
    book_id: book.bookId,
    status: "finished",
    started_at: null,
    finished_at: finishedAt,
    rating: details.rating,
    comment: details.comment?.trim() || null,
  });
  if (error) {
    console.error("[books] recordPastReading:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }

  revalidateLibrarySurfaces();
  return { ok: true, bookId: book.bookId, bookAlreadyExisted: book.alreadyExisted };
}

/**
 * « Je le possède ET je l'ai déjà lu » — le geste de l'interrupteur « Déjà lu »
 * du scan d'étagère (#101 lot C, specs §4.13).
 *
 * Les deux faits en un appel, et pas deux actions enchaînées depuis le client :
 * un aller-retour au lieu de deux, et surtout aucun état intermédiaire visible
 * (un livre « lu mais pas possédé » ressemblerait à un emprunt de médiathèque
 * — exactement ce que ce geste n'est pas).
 *
 * La possession d'abord : si l'enregistrement de la lecture échoue, le livre
 * est au moins dans la bibliothèque. Et « déjà possédé » n'est PAS un échec
 * ici — on redéclare simplement une lecture sur un livre déjà à soi.
 */
export async function recordOwnedPastReading(
  input: BookInput,
  finishedAt: string | null,
): Promise<ScanActionResult> {
  // La possession part SANS date : la date connue est celle de la LECTURE, pas
  // de l'acquisition — on ne fabrique pas de donnée (audit post-#101 ; même
  // principe que partout dans §4.13 : une date inconnue reste inconnue). La
  // dérivation ne change pas (un livre déjà lu n'entre pas en pile, §3.3),
  // seule la donnée stockée reste honnête.
  const ownership = await recordOwnership(input, null);
  // Le seul échec qu'on absorbe : le livre était déjà déclaré. Tout autre
  // (auth, validation, base) doit remonter — il empêcherait aussi la lecture.
  if (!ownership.ok && ownership.error !== ALREADY_OWNED_MESSAGE) return ownership;

  return recordPastReading(input, finishedAt);
}

/**
 * Annuler un achat — suppression douce (specs §7 : rien n'est jamais effacé de
 * la base). Deux points d'entrée : juste après le scan (« Annuler ») et depuis
 * la PAL (« Je ne l'ai pas acheté »). L'achat pèse au barème (malus −1), donc
 * on revalide aussi le bilan.
 */
export async function softDeletePurchase(purchaseId: string): Promise<JournalActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };
  const { supabase, user } = session;

  const { error, count } = await supabase
    .from("purchases")
    .update({ deleted_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", purchaseId)
    .eq("user_id", user.id)
    .is("deleted_at", null);
  if (error) {
    console.error("[books] softDeletePurchase:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!count) return { ok: false, error: "Achat introuvable." };

  revalidatePath("/bibliotheque");
  revalidatePath("/bilan");
  return { ok: true };
}
