/**
 * Le lien du cercle (specs §4.14, lot A) — logique PURE, testée.
 *
 * La table `friendships` stocke une paire CANONIQUE (user_low < user_high,
 * une seule ligne possible par duo) : tout le reste — qui est « l'autre »,
 * demande reçue ou envoyée, que faire quand une demande se cogne sur une
 * ligne existante — se dérive ici, sans toucher à la base.
 */

/** La paire canonique — `null` si on tente de se lier à soi-même. */
export function canonicalPair(a: string, b: string): { userLow: string; userHigh: string } | null {
  if (a === b) return null;
  return a < b ? { userLow: a, userHigh: b } : { userLow: b, userHigh: a };
}

export type FriendshipStatus = "pending" | "accepted";

/** Une ligne `friendships` vue depuis MON compte. */
export type CircleLink = {
  otherId: string;
  requestedByMe: boolean;
  status: FriendshipStatus;
};

type FriendshipRow = {
  user_low: string;
  user_high: string;
  requester_id: string;
  status: string;
};

/** Traduit une ligne brute en lien « vu de moi » — `null` si je n'y suis pas (défensif : la RLS l'interdit déjà). */
export function toCircleLink(row: FriendshipRow, myId: string): CircleLink | null {
  if (row.user_low !== myId && row.user_high !== myId) return null;
  if (row.status !== "pending" && row.status !== "accepted") return null;
  return {
    otherId: row.user_low === myId ? row.user_high : row.user_low,
    requestedByMe: row.requester_id === myId,
    status: row.status,
  };
}

/** Les trois listes du cercle : amis, demandes reçues, demandes envoyées. */
export function splitCircleLinks(rows: FriendshipRow[], myId: string): {
  friendIds: string[];
  receivedIds: string[];
  sentIds: string[];
} {
  const friendIds: string[] = [];
  const receivedIds: string[] = [];
  const sentIds: string[] = [];
  for (const row of rows) {
    const link = toCircleLink(row, myId);
    if (link === null) continue;
    if (link.status === "accepted") friendIds.push(link.otherId);
    else if (link.requestedByMe) sentIds.push(link.otherId);
    else receivedIds.push(link.otherId);
  }
  return { friendIds, receivedIds, sentIds };
}

/**
 * Que faire quand ma demande se cogne sur une ligne existante ? La demande
 * CROISÉE (l'autre m'avait déjà demandé) vaut acceptation (§4.14) ; le reste
 * est un état déjà acquis, on le dit sans rien casser.
 */
export type ExistingRequestOutcome = "autoAccept" | "alreadyFriends" | "alreadySent";

export function classifyExistingForRequest(link: CircleLink): ExistingRequestOutcome {
  if (link.status === "accepted") return "alreadyFriends";
  return link.requestedByMe ? "alreadySent" : "autoAccept";
}

/** Le seuil de la recherche (§4.14) : en dessous, on ne cherche pas — même borne que côté SQL. */
export const SEARCH_PREFIX_MIN_LENGTH = 2;

/**
 * Trim + espaces internes réduits à un (la MÊME normalisation que le pseudo
 * sauvé, #224 — sinon « léna  du » collé avec un double espace ne trouverait
 * jamais « léna du », silencieusement), puis garde du seuil — `null` si trop
 * court pour chercher.
 */
export function normalizeSearchPrefix(raw: string): string | null {
  const value = raw.trim().replace(/\s+/g, " ");
  return value.length >= SEARCH_PREFIX_MIN_LENGTH ? value : null;
}
