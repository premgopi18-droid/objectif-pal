"use server";

import { revalidatePath } from "next/cache";
import { GENERIC_ERROR_MESSAGE } from "@/lib/books/errors";
import {
  canonicalPair,
  classifyExistingForRequest,
  normalizeSearchPrefix,
  toCircleLink,
} from "@/lib/circle/friendship";
import { PSEUDO_TAKEN_MESSAGE, normalizeDisplayName } from "@/lib/profile/display-name";
import type { Month } from "@/lib/scoring/types";
import { getSessionOrError } from "@/lib/supabase/server";

/**
 * Les gestes du cercle (specs §4.14, lot A) — entrer, chercher, demander,
 * accepter, refuser, annuler, retirer. Tout passe par le client SESSION :
 * la RLS de `friendships` et les deux fonctions `security definer` de la
 * migration font autorité. Les sorties sont SILENCIEUSES (§4.14) : refuser,
 * annuler ou retirer supprime la ligne, l'autre ne reçoit rien.
 */

export type CircleActionResult = { ok: true; message?: string } | { ok: false; error: string };

/** Un profil montré par le cercle : le pseudo et la photo, jamais plus (§4.14). */
export type CircleProfile = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};

export type CircleSearchRelation = "none" | "friend" | "sent" | "received";

export type CircleSearchResult = CircleProfile & { relation: CircleSearchRelation };

/** Violation d'unicité Postgres — le pseudo est déjà pris. */
const UNIQUE_VIOLATION = "23505";
/** Violation de RLS — l'autre compte n'est pas (ou plus) entré au cercle. */
const RLS_VIOLATION = "42501";

const REQUEST_QUOTA_MESSAGE = "Trop de demandes d'un coup — réessaie dans une minute.";
const SEARCH_QUOTA_MESSAGE = "Trop de recherches d'un coup — réessaie dans une minute.";
const REQUEST_GONE_MESSAGE = "Cette demande n'existe plus.";
const NOT_IN_CIRCLE_MESSAGE = "Ce compte n'est pas (ou plus) dans le cercle.";

/**
 * La porte du cercle (§4.14) : confirmer — ou choisir — son pseudo, et le
 * cercle s'ouvre. C'est ce geste qui rend le compte CHERCHABLE : un pseudo
 * par défaut (nom Google, début d'email) n'est jamais publié sans ce choix.
 */
export async function joinCircle(rawDisplayName: string): Promise<CircleActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };

  const normalized = normalizeDisplayName(rawDisplayName);
  if (!normalized.ok) return normalized;

  const { error } = await session.supabase
    .from("profiles")
    .update({ display_name: normalized.value, circle_joined_at: new Date().toISOString() })
    .eq("id", session.user.id)
    .is("circle_joined_at", null);
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { ok: false, error: PSEUDO_TAKEN_MESSAGE };
    console.error("[circle] joinCircle:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }

  revalidatePath("/profil");
  return { ok: true };
}

/**
 * La recherche par préfixe (§4.14) — bornée côté SQL (2 caractères, 10
 * résultats, quota, comptes entrés au cercle seulement). On y accroche la
 * relation existante : le bouton d'un résultat dit « Demander », « Accepter »,
 * « Demande envoyée » ou « Déjà ami », jamais un geste qui échouerait.
 */
export async function searchCircle(
  rawPrefix: string,
): Promise<{ ok: true; results: CircleSearchResult[] } | { ok: false; error: string }> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };

  const prefix = normalizeSearchPrefix(rawPrefix);
  if (prefix === null) return { ok: true, results: [] };

  const { data: rows, error } = await session.supabase.rpc("search_circle_profiles", { prefix });
  if (error) {
    if (error.message.includes("quota")) return { ok: false, error: SEARCH_QUOTA_MESSAGE };
    console.error("[circle] searchCircle:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!rows || rows.length === 0) return { ok: true, results: [] };

  const { data: links, error: linksError } = await session.supabase
    .from("friendships")
    .select("user_low, user_high, requester_id, status");
  if (linksError) {
    console.error("[circle] searchCircle links:", linksError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }

  const relationById = new Map<string, CircleSearchRelation>();
  for (const row of links ?? []) {
    const link = toCircleLink(row, session.user.id);
    if (link === null) continue;
    relationById.set(
      link.otherId,
      link.status === "accepted" ? "friend" : link.requestedByMe ? "sent" : "received",
    );
  }

  return {
    ok: true,
    results: rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      relation: relationById.get(row.id) ?? "none",
    })),
  };
}

/**
 * Envoyer une demande. La paire est canonique : si une ligne existe déjà, on
 * la lit et on agit selon — demande CROISÉE → acceptation automatique (§4.14),
 * déjà envoyée / déjà amis → on le dit, rien ne casse. Le retour porte la
 * relation RÉSULTANTE : le bouton du résultat de recherche se met à jour
 * sans re-chercher (le quota de recherche n'est pas repayé).
 */
export type SendRequestResult =
  | { ok: true; message?: string; relation: "sent" | "friend" }
  | { ok: false; error: string };

export async function sendFriendRequest(otherId: string): Promise<SendRequestResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };

  const pair = canonicalPair(session.user.id, otherId);
  if (pair === null) return { ok: false, error: GENERIC_ERROR_MESSAGE };

  const { data: allowed, error: quotaError } = await session.supabase.rpc("consume_action_quota", {
    action_kind: "friend_request",
  });
  if (quotaError) {
    console.error("[circle] sendFriendRequest quota:", quotaError.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!allowed) return { ok: false, error: REQUEST_QUOTA_MESSAGE };

  const { error } = await session.supabase.from("friendships").insert({
    user_low: pair.userLow,
    user_high: pair.userHigh,
    requester_id: session.user.id,
  });

  if (error && error.code === UNIQUE_VIOLATION) {
    // La paire existe déjà : on relit la ligne pour décider (logique pure).
    const { data: existing, error: readError } = await session.supabase
      .from("friendships")
      .select("user_low, user_high, requester_id, status")
      .eq("user_low", pair.userLow)
      .eq("user_high", pair.userHigh)
      .maybeSingle();
    if (readError || !existing) {
      console.error("[circle] sendFriendRequest reread:", readError?.message ?? "ligne disparue");
      return { ok: false, error: GENERIC_ERROR_MESSAGE };
    }
    const link = toCircleLink(existing, session.user.id);
    if (link === null) return { ok: false, error: GENERIC_ERROR_MESSAGE };
    switch (classifyExistingForRequest(link)) {
      case "autoAccept": {
        const accepted = await acceptFriendRequest(otherId);
        return accepted.ok ? { ...accepted, relation: "friend" } : accepted;
      }
      case "alreadyFriends":
        return { ok: true, message: "Vous êtes déjà amis.", relation: "friend" };
      case "alreadySent":
        return { ok: true, message: "Demande déjà envoyée.", relation: "sent" };
    }
  }
  if (error) {
    if (error.code === RLS_VIOLATION) return { ok: false, error: NOT_IN_CIRCLE_MESSAGE };
    console.error("[circle] sendFriendRequest:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }

  revalidatePath("/profil");
  return { ok: true, message: "Demande envoyée ✓", relation: "sent" };
}

/** Accepter une demande reçue — seule transition permise par la RLS (pending → accepted, par le destinataire). */
export async function acceptFriendRequest(otherId: string): Promise<CircleActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };

  const pair = canonicalPair(session.user.id, otherId);
  if (pair === null) return { ok: false, error: GENERIC_ERROR_MESSAGE };

  const { data: updated, error } = await session.supabase
    .from("friendships")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("user_low", pair.userLow)
    .eq("user_high", pair.userHigh)
    .eq("status", "pending")
    .eq("requester_id", otherId)
    .select("id");
  if (error) {
    console.error("[circle] acceptFriendRequest:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
  if (!updated || updated.length === 0) return { ok: false, error: REQUEST_GONE_MESSAGE };

  revalidatePath("/profil");
  return { ok: true, message: "Vous êtes amis ✓" };
}

/**
 * Les trois sorties — refuser (une demande reçue), annuler (une demande
 * envoyée), retirer (un ami). Un seul verbe SQL (DELETE, §4.14), des filtres
 * distincts pour que le geste ne supprime jamais autre chose que ce qu'il
 * croit. Silencieux : zéro ligne touchée n'est pas une erreur.
 */
async function deleteFriendship(
  otherId: string,
  filters: { status: "pending" | "accepted"; requesterId?: string },
): Promise<CircleActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };

  const pair = canonicalPair(session.user.id, otherId);
  if (pair === null) return { ok: false, error: GENERIC_ERROR_MESSAGE };

  let query = session.supabase
    .from("friendships")
    .delete()
    .eq("user_low", pair.userLow)
    .eq("user_high", pair.userHigh)
    .eq("status", filters.status);
  if (filters.requesterId !== undefined) query = query.eq("requester_id", filters.requesterId);

  const { error } = await query;
  if (error) {
    console.error("[circle] deleteFriendship:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }

  revalidatePath("/profil");
  return { ok: true };
}

export async function declineFriendRequest(otherId: string): Promise<CircleActionResult> {
  return deleteFriendship(otherId, { status: "pending", requesterId: otherId });
}

export async function cancelFriendRequest(otherId: string): Promise<CircleActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };
  return deleteFriendship(otherId, { status: "pending", requesterId: session.user.id });
}

export async function removeFriend(otherId: string): Promise<CircleActionResult> {
  return deleteFriendship(otherId, { status: "accepted" });
}

/**
 * Révéler un mois clos au cercle (#243) — le geste de fin d'émission, à SENS
 * UNIQUE (aucune policy UPDATE/DELETE : comme l'antenne, on ne dé-révèle
 * pas). La RLS n'accepte qu'un mois CLOS (frontière UTC) ; re-révéler est
 * idempotent. Sans reveal manuel, la bascule automatique s'en charge au 1er
 * du mois suivant — un prédicat de temps côté serveur, pas une action.
 */
export async function revealMonth(month: Month): Promise<CircleActionResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Authentification requise." };

  const { error } = await session.supabase
    .from("monthly_reveals")
    .insert({ user_id: session.user.id, month: `${month}-01` });
  if (error && error.code === UNIQUE_VIOLATION) {
    // Déjà révélé (double tap, deux onglets) : l'état voulu est acquis.
    return { ok: true, message: "Déjà révélé au cercle ✓" };
  }
  if (error) {
    if (error.code === RLS_VIOLATION) return { ok: false, error: "Ce mois n'est pas encore clos — rien à révéler." };
    console.error("[circle] revealMonth:", error.message);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }

  revalidatePath("/bilan");
  revalidatePath("/profil/cercle");
  return { ok: true, message: "Révélé au cercle ✓" };
}
