import "server-only";

import type { CircleProfile } from "@/lib/circle/actions";
import { splitCircleLinks } from "@/lib/circle/friendship";
import type { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Les lectures du cercle (specs §4.14, lot A) — côté serveur, pour la page
 * Profil et la pastille de la nav. Les pseudos + photos des comptes liés
 * viennent de `get_circle_profiles()` (security definer : le lien autorise la
 * lecture, `profiles_select_own` ne bouge pas).
 */

type SessionSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

export type CircleView = {
  /** La porte (§4.14) : tant qu'on n'est pas entré, rien du cercle n'existe. */
  joined: boolean;
  friends: CircleProfile[];
  received: CircleProfile[];
  sent: CircleProfile[];
};

export async function getCircleView(supabase: SessionSupabaseClient, userId: string): Promise<CircleView> {
  const [{ data: profile }, { data: links }, { data: linkedProfiles }] = await Promise.all([
    supabase.from("profiles").select("circle_joined_at").eq("id", userId).single(),
    supabase.from("friendships").select("user_low, user_high, requester_id, status"),
    supabase.rpc("get_circle_profiles"),
  ]);

  const joined = profile?.circle_joined_at != null;
  const profileById = new Map<string, CircleProfile>(
    (linkedProfiles ?? []).map((row) => [
      row.id,
      { id: row.id, displayName: row.display_name, avatarUrl: row.avatar_url },
    ]),
  );
  // Filet : un profil que la fonction n'aurait pas rendu (course avec une
  // suppression de compte) s'affiche anonyme plutôt que de faire disparaître
  // la ligne — le geste (accepter, retirer) reste possible.
  const resolve = (ids: string[]): CircleProfile[] =>
    ids.map((id) => profileById.get(id) ?? { id, displayName: "lecteur", avatarUrl: null });

  const { friendIds, receivedIds, sentIds } = splitCircleLinks(links ?? [], userId);
  const byName = (a: CircleProfile, b: CircleProfile) =>
    a.displayName.localeCompare(b.displayName, "fr", { sensitivity: "base" });

  return {
    joined,
    friends: resolve(friendIds).sort(byName),
    received: resolve(receivedIds).sort(byName),
    sent: resolve(sentIds).sort(byName),
  };
}

/**
 * Le compte des demandes REÇUES en attente — la pastille de l'onglet Profil
 * (§4.14 : vue, pas poussée). Via la fonction SQL `count_pending_friend_requests`
 * (lot B, suivi review #227) : l'identité vient du jeton (`auth.uid()`), le
 * layout n'a plus AUCUN aller-retour d'auth — un seul appel réseau, et sans
 * session la fonction rend 0.
 */
export async function getPendingRequestCount(supabase: SessionSupabaseClient): Promise<number> {
  const { data, error } = await supabase.rpc("count_pending_friend_requests");
  if (error) {
    // La pastille n'a pas le droit de casser la nav : zéro et on le note.
    console.error("[circle] getPendingRequestCount:", error.message);
    return 0;
  }
  return data ?? 0;
}
