"use server";

import { revalidatePath } from "next/cache";
import { getSessionOrError } from "@/lib/supabase/server";
import { isValidIsoDate } from "@/lib/dates";
import { GENERIC_ERROR_MESSAGE } from "@/lib/books/errors";
import {
  recordOwnership,
  recordOwnedPastReading,
  recordPastReading,
  recordPurchase,
  type BookInput,
  type ScanActionResult,
} from "@/lib/books/actions";
import type { JournalActionResult } from "@/lib/books/journal-actions";
import type { ScanIntent } from "@/lib/books/scan-inbox";
import type { Json } from "@/lib/supabase/database.types";

/**
 * La boîte de finition (#101 lot C) — le corollaire de « la rafale ne s'arrête
 * jamais ». Un scan qui ne se résout pas n'est pas un échec : il est CAPTÉ ici
 * avec son intention, et finalisé plus tard.
 *
 * Ces actions ne touchent jamais au barème : finaliser un élément rejoue
 * exactement les gestes de #101 lot B (`recordOwnership` / `recordPastReading`),
 * qui n'atteignent pas le moteur de score.
 */

/** Ce que la rafale capte quand elle n'a pas pu créer le livre. */
export type ScanInboxCapture = {
  barcodeRaw: string | null;
  barcodeType: "isbn" | "upc" | null;
  /** La couverture trouvée malgré l'identification ratée, ou la photo prise. */
  coverUrl: string | null;
  /**
   * Ce que la cascade a trouvé de partiel — un brouillon pour pré-remplir la
   * finition. Typé `Json` (et non `Record<string, unknown>`) : c'est ce que la
   * colonne jsonb accepte, et ça interdit d'y glisser une valeur non
   * sérialisable qui casserait à l'écriture.
   */
  resolvedMetadata: Json | null;
  intent: ScanIntent;
  ownedSince: string | null;
  finishedAt: string | null;
};

const validateCaptureDates = (capture: ScanInboxCapture): string | null => {
  if (capture.ownedSince !== null && !isValidIsoDate(capture.ownedSince)) return "Date d'acquisition invalide.";
  if (capture.finishedAt !== null && !isValidIsoDate(capture.finishedAt)) return "Date de fin invalide.";
  return null;
};

/**
 * Capter un scan à finaliser. Rend `duplicate: true` quand le même code est
 * DÉJÀ en attente : en rafale on repasse forcément sur des livres, et ça ne
 * doit produire ni doublon ni interruption — juste un signal doux.
 */
export async function addToScanInbox(
  capture: ScanInboxCapture,
): Promise<{ ok: true; id: string | null; duplicate: boolean } | { ok: false; error: string }> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };
  const { supabase, user } = session;

  const invalidDate = validateCaptureDates(capture);
  if (invalidDate) return { ok: false, error: invalidDate };
  // La base l'impose aussi (`scan_inbox_identifiable`), mais le message est
  // plus clair ici : sans code ni photo, il ne resterait rien à identifier.
  if (capture.barcodeRaw === null && capture.coverUrl === null) {
    return { ok: false, error: "Sans code-barres, une photo est nécessaire." };
  }
  // Un achat a TOUJOURS une date (#120) — la rafale l'envoie (session, défaut
  // aujourd'hui) ; sans elle, la finition ne saurait pas dater le malus.
  if (capture.intent === "purchase" && capture.ownedSince === null) {
    return { ok: false, error: "Un achat a besoin d'une date." };
  }

  if (capture.barcodeRaw !== null) {
    const { data: existing, error } = await supabase
      .from("scan_inbox")
      .select("id")
      .eq("user_id", user.id)
      .eq("barcode_raw", capture.barcodeRaw)
      .eq("status", "pending")
      .is("deleted_at", null)
      .maybeSingle();
    if (error) {
      console.error("[scan-inbox] addToScanInbox:", error.message);
      return { ok: false, error: GENERIC_ERROR_MESSAGE };
    }
    if (existing) return { ok: true, id: existing.id, duplicate: true };
  }

  const { data: inserted, error } = await supabase
    .from("scan_inbox")
    .insert({
      user_id: user.id,
      barcode_raw: capture.barcodeRaw,
      barcode_type: capture.barcodeType,
      cover_url: capture.coverUrl,
      resolved_metadata: capture.resolvedMetadata,
      intent: capture.intent,
      owned_since: capture.ownedSince,
      finished_at: capture.finishedAt,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[scan-inbox] addToScanInbox:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }

  // PAS de `revalidatePath("/")` ici, volontairement : `/` est l'écran sur
  // lequel on se trouve en pleine rafale, et capter un livre déclencherait un
  // rendu serveur de cet écran à chaque scan non résolu — des dizaines par
  // étagère, pendant que la caméra tourne. La pastille de `/` n'a pas besoin
  // d'être juste PENDANT la session (la rafale tient son propre compteur, en
  // local) : elle sert à ne pas oublier la boîte en revenant, et le compteur
  // est alors recalculé au chargement de la page.
  revalidatePath("/finition");
  return { ok: true, id: inserted.id, duplicate: false };
}

/**
 * Finaliser un élément : créer le livre et appliquer l'INTENTION captée au
 * scan. L'utilisateur a déjà dit ce qu'il voulait — on ne le redemande pas.
 *
 * Idempotence : la ligne ne passe à `completed` que si elle était `pending`
 * (le `.eq("status", "pending")` filtre la mise à jour). Deux soumissions
 * concurrentes créeraient au pire deux livres — mais `findOrCreateBook`
 * déduplique déjà sur `barcode_raw`, donc en pratique le second geste
 * réutilise le premier livre.
 */
export async function completeScanInboxItem(itemId: string, input: BookInput): Promise<ScanActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };
  const { supabase, user } = session;

  const { data: item, error: readError } = await supabase
    .from("scan_inbox")
    .select("id, intent, owned_since, finished_at, status")
    .eq("id", itemId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError) {
    console.error("[scan-inbox] completeScanInboxItem:", readError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!item) return { ok: false, error: "Élément introuvable." };
  if (item.status === "completed") return { ok: false, error: "Cet élément est déjà finalisé." };

  // On rejoue EXACTEMENT les gestes du lot B — pas une écriture parallèle :
  // toutes leurs gardes (doublon de pile, lecture en cours, dates) valent ici.
  const result =
    item.intent === "own_read"
      ? // Possédé ET lu — les deux, comme en rafale (§4.13) : la boîte
        // rejoue l'intention à l'identique, sans la réinterpréter.
        await recordOwnedPastReading(input, item.finished_at)
      : item.intent === "read"
        ? // L'emprunt (#113) : lu, jamais possédé — aucune possession fabriquée.
          await recordPastReading(input, item.finished_at)
        : item.intent === "purchase"
          ? // Le retour de librairie (#120) : l'achat daté, malus compris. La
            // date vit dans owned_since (une acquisition) — exigée à la capture.
            item.owned_since === null
            ? { ok: false as const, error: "Un achat a besoin d'une date." }
            : await recordPurchase(input, item.owned_since)
          : await recordOwnership(input, item.owned_since);
  if (!result.ok) return result;

  const { error: updateError } = await supabase
    .from("scan_inbox")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", itemId)
    .eq("user_id", user.id)
    .eq("status", "pending");
  if (updateError) {
    // Le livre EXISTE déjà (le geste a réussi) : on ne fait pas échouer
    // l'utilisateur pour une ligne de suivi. L'élément restera en attente et
    // sera re-finalisable — `findOrCreateBook` réutilisera le même livre.
    console.error("[scan-inbox] completeScanInboxItem (marquage):", updateError.message);
  }

  revalidatePath("/");
  revalidatePath("/finition");
  return result;
}

/** Écarter un élément — scan raté, livre de quelqu'un d'autre. Suppression douce (§7). */
export async function dismissScanInboxItem(itemId: string): Promise<JournalActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };
  const { supabase, user } = session;

  const { error, count } = await supabase
    .from("scan_inbox")
    .update({ deleted_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", itemId)
    .eq("user_id", user.id)
    .is("deleted_at", null);
  if (error) {
    console.error("[scan-inbox] dismissScanInboxItem:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!count) return { ok: false, error: "Élément introuvable." };

  revalidatePath("/");
  revalidatePath("/finition");
  return { ok: true };
}
