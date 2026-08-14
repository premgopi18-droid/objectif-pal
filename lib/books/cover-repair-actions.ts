"use server";

import { revalidatePath } from "next/cache";
import { decideCoverRepair, isKnownCoverImageUrl, isRepairAttemptFresh } from "@/lib/books/cover-repair";
import { isHouseCoverPhotoUrl } from "@/lib/books/cover-photo";
import { isActionAllowed } from "@/lib/resolution/lookup-rate-limit";
import { createCacheProvider } from "@/lib/resolution/providers/cache";
import { findReplacementCover } from "@/lib/resolution/resolve";
import { OUTBOUND_USER_AGENT, PROVIDER_REQUEST_TIMEOUT_MILLISECONDS } from "@/lib/resolution/types";
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
  // Un 200 à CORPS VIDE est un cadavre (#154 bis, vu en prod : Inventaire sert
  // parfois un 200 image/webp de 0 octet) — sans ce test, l'URL morte passait
  // pour vivante et la photo (#33) n'était jamais proposée. L'absence d'en-tête
  // content-length reste un doute → profite à l'existant, comme le reste.
  const hasEmptyBody = (response: Response) => response.headers.get("content-length") === "0";
  // redirect: "manual" (#193) : suivre une redirection depuis un hôte
  // allowlisté ouvrirait un canal vers une cible arbitraire. Un 3xx n'est ni
  // vivant ni mort — un doute, qui profite à l'existant.
  const verdict = (response: Response) =>
    response.status >= 300 && response.status < 400 ? null : response.ok && !hasEmptyBody(response);
  const options = {
    headers: { "User-Agent": OUTBOUND_USER_AGENT },
    redirect: "manual" as const,
    signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MILLISECONDS),
  };
  try {
    const head = await fetch(url, { ...options, method: "HEAD" });
    if (head.status !== 405) return verdict(head);
    const get = await fetch(url, options);
    await get.body?.cancel();
    return verdict(get);
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
    .select("cover_url, isbn, barcode_raw, barcode_type, cover_repair_attempted_at")
    .eq("id", bookId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !book?.cover_url) return { coverUrl: null };

  // Une photo maison ne se « répare » pas ici — elle est chez nous.
  if (isHouseCoverPhotoUrl(book.cover_url)) return { coverUrl: book.cover_url };

  // L'anti-boucle PERSISTANTE (#177) : le Set mémoire du client meurt au
  // rechargement — ce tampon-ci survit. Une tentative récente (< 7 j) ne se
  // repaie pas, quel que soit l'appareil qui affiche la vignette.
  if (isRepairAttemptFresh(book.cover_repair_attempted_at)) return { coverUrl: book.cover_url };

  // Le quota dédié (#177) : la réparation était le chemin externe le plus
  // coûteux (~8 appels) et le seul non métré — 5/min/utilisateur suffit à un
  // usage réel (une couverture morte est rare), une salve est un emballement.
  if (!(await isActionAllowed(supabase, "cover_repair"))) return { coverUrl: book.cover_url };

  // Tamponné AVANT de tenter : un échec de chaîne ne re-tente pas en boucle.
  // Et JAMAIS effacé, même sur succès (review #185) : si la remplaçante meurt
  // à son tour dans les 7 jours, on attend l'expiration — un livre ne mérite
  // pas plus d'un essai hebdomadaire, la photo (#33) reste le filet. Deux
  // appareils simultanés peuvent passer le tampon tous les deux (lu avant
  // écrit) : borné par le quota 5/min, assumé.
  await supabase
    .from("books")
    .update({ cover_repair_attempted_at: new Date().toISOString() })
    .eq("id", bookId)
    .eq("user_id", user.id);

  const barcodeType = book.barcode_type as "isbn" | "upc" | null;
  const foundCoverUrl = barcodeType
    ? await findReplacementCover({ barcodeType, isbn: book.isbn, barcode: book.barcode_raw })
    : null;
  // La re-vérification de l'URL actuelle ne sert qu'au cas « rien trouvé ».
  const currentUrlIsAlive = foundCoverUrl ? null : await isUrlAlive(book.cover_url);
  const decision = decideCoverRepair(book.cover_url, foundCoverUrl, currentUrlIsAlive);

  if (decision.action === "keep") return { coverUrl: book.cover_url };

  const newCoverUrl = decision.action === "replace" ? decision.coverUrl : null;
  // Double filtre user_id : la RLS couvre déjà, mais c'est la discipline du
  // repo partout ailleurs (relevé par l'audit du 14/08/2026).
  const { error: updateError } = await supabase
    .from("books")
    .update({ cover_url: newCoverUrl })
    .eq("id", bookId)
    .eq("user_id", user.id);
  if (updateError) {
    console.error("[covers] repairBrokenCover:", updateError.message);
    return { coverUrl: book.cover_url };
  }
  const cacheKey = barcodeType === "isbn" ? book.isbn : book.barcode_raw;
  await repairCacheEntry(cacheKey, book.cover_url, newCoverUrl);

  revalidatePath("/journal");
  revalidatePath("/bibliotheque");
  return { coverUrl: newCoverUrl };
}
