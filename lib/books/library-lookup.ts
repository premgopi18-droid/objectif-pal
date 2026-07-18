import { classifyScannedCode } from "@/lib/resolution/barcode-router";
import type { ResolvedBook } from "@/lib/resolution/types";
import type { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Le provider « bibliothèque » — issue #10 : AVANT toute la cascade (cache,
 * GCD, BnF, Google Books, Metron), chercher le code dans les livres DÉJÀ
 * enregistrés par l'utilisateur. Rescanner un indé saisi à la main ne doit
 * plus retomber sur « introuvable » : le livre existe, l'app le sait, elle le
 * dit (« tu l'as déjà » — specs §4.2). Bonus : zéro appel externe, zéro quota.
 *
 * Le match suit la règle de la dédup à l'écriture (`findOrCreateBook`) :
 * `(user_id, barcode_raw)` exact. Plus un repli pour les ISBN : le même livre
 * scanné avec puis sans le supplément prix donne deux codes bruts différents —
 * on matche alors sur la colonne `isbn` (l'EAN-13 normalisé), exactement la
 * clé qu'utilise le cache de résolutions (specs §5.1).
 */

type SessionSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

const LIBRARY_BOOK_COLUMNS =
  "title, series_name, issue_number, authors, publisher, page_count, category, cover_url, barcode_raw, barcode_type, isbn, metadata_source, metadata_source_id";

/**
 * Cherche le code scanné dans la bibliothèque de l'utilisateur. Un livre
 * supprimé en douceur n'est PAS un match : l'utilisateur l'a retiré, le scan
 * repart par la cascade normale (et la dédup d'écriture le ressuscitera s'il
 * le re-enregistre).
 */
export async function findBookInLibrary(
  supabase: SessionSupabaseClient,
  userId: string,
  raw: string,
): Promise<ResolvedBook | null> {
  const code = classifyScannedCode(raw);
  // Code inexploitable : aucun livre n'a pu être enregistré sous lui, inutile
  // de requêter.
  if (code.type === "invalid") return null;
  // TOUJOURS les chiffres normalisés (`code.raw`), jamais le paramètre brut
  // (review #40) : c'est sous cette forme que la résolution stocke
  // `barcode_raw`, et c'est la garantie « 100 % chiffres » qui rend le filtre
  // `or` PostgREST non forgeable.
  const digits = code.raw;
  const ean13 = code.type === "isbn" ? code.ean13 : null;

  let query = supabase.from("books").select(LIBRARY_BOOK_COLUMNS).eq("user_id", userId).is("deleted_at", null);
  // Pour un UPC, le supplément est SIGNIFIANT (numéro, couverture) : match brut uniquement.
  query = ean13 ? query.or(`barcode_raw.eq.${digits},isbn.eq.${ean13}`) : query.eq("barcode_raw", digits);

  const { data, error } = await query.limit(2);
  if (error) {
    // Le provider bibliothèque ne casse jamais le scan : on descend d'un cran
    // (la cascade normale), comme pour toute source en échec (specs §8).
    console.error("[library-lookup] findBookInLibrary:", error.message);
    return null;
  }
  if (!data || data.length === 0) return null;

  // Deux exemplaires possibles (raw + isbn) : le match exact sur le code brut
  // l'emporte — c'est LE livre scanné, pas son jumeau sans supplément.
  const row = data.find((candidate) => candidate.barcode_raw === digits) ?? data[0];

  return {
    title: row.title,
    seriesName: row.series_name,
    issueNumber: row.issue_number,
    authors: row.authors,
    publisher: row.publisher,
    pageCount: row.page_count,
    coverUrl: row.cover_url,
    // La catégorie du livre : le choix (éventuellement corrigé) de
    // l'utilisateur — la meilleure suggestion possible.
    suggestedCategory: row.category,
    source: row.metadata_source,
    sourceId: row.metadata_source_id,
    barcodeType: row.barcode_type ?? (code.type === "upc" ? "upc" : "isbn"),
    barcode: row.barcode_raw,
    isbn: row.isbn,
  };
}
