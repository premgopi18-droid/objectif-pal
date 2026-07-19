"use server";

import { revalidatePath } from "next/cache";
import { decideCoverRepair, isKnownCoverImageUrl } from "@/lib/books/cover-repair";
import { isHouseCoverPhotoUrl } from "@/lib/books/cover-photo";
import { createCacheProvider } from "@/lib/resolution/providers/cache";
import { findReplacementCover } from "@/lib/resolution/resolve";
import { PROVIDER_REQUEST_TIMEOUT_MILLISECONDS } from "@/lib/resolution/types";
import { getSessionOrError } from "@/lib/supabase/server";

/**
 * La réparation d'un lien de couverture cassé (issue #53), déclenchée par le
 * `onError` de l'image côté client : re-dérouler la chaîne couverture, mettre
 * à jour `books.cover_url` (et l'entrée `barcode_cache`), ou — si l'URL est
 * confirmée morte et rien ne la remplace — retomber sur « sans couverture »,
 * où l'UI propose déjà la photo (#33).
 *
 * Les photos MAISON ne passent pas ici : elles vivent dans notre bucket, un
 * échec de chargement ne peut pas venir d'un tiers qui a fermé la porte.
 */

export type CoverRepairResult = { coverUrl: string | null };

/**
 * Le verdict serveur sur l'URL actuelle — `null` si indéterminable (réseau,
 * timeout) : le doute profite à l'existant, on ne vide pas sur un signal
 * ambigu. Un HEAD suffit (les CDN d'images le servent) ; s'il est refusé
 * (405), on retombe sur un GET dont on relâche le corps.
 */
async function isUrlAlive(url: string): Promise<boolean | null> {
  // Garde SSRF (review #57) : jamais de fetch serveur hors des hôtes de
  // couverture connus. Indéterminable → le doute profite à l'existant (keep).
  if (!isKnownCoverImageUrl(url)) return null;
  try {
    const head = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MILLISECONDS) });
    if (head.status !== 405) return head.ok;
    const get = await fetch(url, { signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MILLISECONDS) });
    await get.body?.cancel();
    return get.ok;
  } catch {
    return null;
  }
}

/** Répercute la réparation sur l'entrée de cache partagée — jamais bloquant. */
async function repairCacheEntry(cacheKey: string | null, deadCoverUrl: string, newCoverUrl: string | null): Promise<void> {
  if (!cacheKey) return;
  try {
    const cache = createCacheProvider();
    const entry = await cache.get(cacheKey);
    // On ne touche l'entrée que si elle sert ENCORE l'URL morte : une entrée
    // déjà réparée par ailleurs (rescan) n'est pas régressée.
    if (!entry || entry.coverUrl !== deadCoverUrl) return;
    await cache.set({ ...entry, coverUrl: newCoverUrl });
  } catch (error) {
    console.error("[covers] repairCacheEntry:", error instanceof Error ? error.message : String(error));
  }
}

export async function repairBrokenCover(bookId: string): Promise<CoverRepairResult> {
  const session = await getSessionOrError();
  if (!session) return { coverUrl: null };
  const { supabase, user } = session;

  const { data: book, error } = await supabase
    .from("books")
    .select("cover_url, isbn, barcode_raw, barcode_type")
    .eq("id", bookId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !book?.cover_url) return { coverUrl: null };

  // Une photo maison ne se « répare » pas ici — elle est chez nous.
  if (isHouseCoverPhotoUrl(book.cover_url)) return { coverUrl: book.cover_url };

  const barcodeType = book.barcode_type as "isbn" | "upc" | null;
  const foundCoverUrl = barcodeType
    ? await findReplacementCover({ barcodeType, isbn: book.isbn, barcode: book.barcode_raw })
    : null;
  // La re-vérification de l'URL actuelle ne sert qu'au cas « rien trouvé ».
  const currentUrlIsAlive = foundCoverUrl ? null : await isUrlAlive(book.cover_url);
  const decision = decideCoverRepair(book.cover_url, foundCoverUrl, currentUrlIsAlive);

  if (decision.action === "keep") return { coverUrl: book.cover_url };

  const newCoverUrl = decision.action === "replace" ? decision.coverUrl : null;
  const { error: updateError } = await supabase.from("books").update({ cover_url: newCoverUrl }).eq("id", bookId);
  if (updateError) {
    console.error("[covers] repairBrokenCover:", updateError.message);
    return { coverUrl: book.cover_url };
  }
  const cacheKey = barcodeType === "isbn" ? book.isbn : book.barcode_raw;
  await repairCacheEntry(cacheKey, book.cover_url, newCoverUrl);

  revalidatePath("/journal");
  revalidatePath("/pal");
  return { coverUrl: newCoverUrl };
}
