import "server-only";

import { splitCircleLinks } from "@/lib/circle/friendship";
import { parseStoredMonthlyReport } from "@/lib/circle/stored-report";
import type { PickKind } from "@/lib/books/pick-kinds";
import type { StoredMonthlyReport } from "@/lib/scoring/closed-months";
import type { Month } from "@/lib/scoring/types";
import type { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Les bilans du cercle (specs §4.14, lot B) — la couche de lecture des
 * surfaces comparées. Mes lignes se lisent en direct (RLS own) ; celles des
 * amis passent par les DEUX fonctions `security definer` de la migration
 * (#229) : agrégats et distinctions des mois clos, jamais une lecture brute.
 *
 * Chaque jsonb passe par `parseStoredMonthlyReport` : une ligne illisible
 * (écrite par une vieille version) est écartée et COMPTÉE — l'UI dit « bilan
 * indisponible », jamais un chiffre inventé ni un crash.
 */

type SessionSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

export type ParticipantPick = { kind: PickKind; readingId: string };

export type CircleParticipant = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  isMe: boolean;
  /** Mois clos (`YYYY-MM`) → ligne d'agrégat parsée. */
  reportsByMonth: Record<Month, StoredMonthlyReport>;
  /** Mois dont la ligne existe mais n'a pas pu être lue — affichés « indisponible ». */
  unreadableMonths: Month[];
  /**
   * Mois VERROUILLÉS (#243) : la ligne existe chez l'ami mais son bilan n'est
   * pas encore révélé — le serveur la sert avec `report` NULL (le teasing).
   * Trois états, trois rendus : plein / 🔒 verrouillé / illisible.
   */
  lockedMonths: Month[];
  /** Mois clos → distinctions (type + lecture ; le titre se résout via `finishedReadings`). */
  picksByMonth: Record<Month, ParticipantPick[]>;
};

export type CircleReportsView = {
  joined: boolean;
  /** Moi + mes amis acceptés, triés par pseudo (moi inclus dans le tri). */
  participants: CircleParticipant[];
  /** MES reveals manuels (`YYYY-MM`) — l'état de ce que le cercle voit de moi (#243). */
  myManualReveals: Month[];
};

export async function getCircleReportsView(
  supabase: SessionSupabaseClient,
  userId: string,
): Promise<CircleReportsView> {
  const [
    { data: myProfile },
    { data: links },
    { data: linkedProfiles },
    { data: myReports },
    { data: myPicks },
    { data: myReveals },
    { data: friendReports, error: friendReportsError },
    { data: friendPicks, error: friendPicksError },
  ] = await Promise.all([
    supabase.from("profiles").select("display_name, avatar_url, circle_joined_at").eq("id", userId).single(),
    supabase.from("friendships").select("user_low, user_high, requester_id, status"),
    supabase.rpc("get_circle_profiles"),
    supabase.from("monthly_reports").select("month, report"),
    supabase.from("monthly_picks").select("month, kind, reading_id"),
    supabase.from("monthly_reveals").select("month"),
    supabase.rpc("get_circle_monthly_reports"),
    supabase.rpc("get_circle_monthly_picks"),
  ]);
  if (friendReportsError) console.error("[circle] get_circle_monthly_reports:", friendReportsError.message);
  if (friendPicksError) console.error("[circle] get_circle_monthly_picks:", friendPicksError.message);

  const joined = myProfile?.circle_joined_at != null;
  const { friendIds } = splitCircleLinks(links ?? [], userId);
  const profileById = new Map((linkedProfiles ?? []).map((row) => [row.id, row]));

  const participants = new Map<string, CircleParticipant>();
  const addParticipant = (id: string, displayName: string, avatarUrl: string | null, isMe: boolean) => {
    participants.set(id, {
      id,
      displayName,
      avatarUrl,
      isMe,
      reportsByMonth: {},
      unreadableMonths: [],
      lockedMonths: [],
      picksByMonth: {},
    });
  };

  addParticipant(userId, myProfile?.display_name ?? "moi", myProfile?.avatar_url ?? null, true);
  for (const friendId of friendIds) {
    const profile = profileById.get(friendId);
    // Filet (course avec une suppression de compte) : anonyme plutôt qu'absent.
    addParticipant(friendId, profile?.display_name ?? "lecteur", profile?.avatar_url ?? null, false);
  }

  const ingestReport = (ownerId: string, monthDate: string, rawReport: unknown) => {
    const participant = participants.get(ownerId);
    if (participant === undefined) return; // ligne d'un compte retiré entre deux requêtes
    const month = monthDate.slice(0, 7);
    const parsed = parseStoredMonthlyReport(rawReport);
    if (parsed === null) participant.unreadableMonths.push(month);
    else participant.reportsByMonth[month] = parsed;
  };
  for (const row of myReports ?? []) ingestReport(userId, row.month, row.report);
  for (const row of friendReports ?? []) {
    // Le verrou serveur (#243) : `report` NULL = mois pas encore révélé —
    // un ÉTAT à part entière, jamais confondu avec une ligne illisible.
    if (!row.revealed || row.report === null) {
      participants.get(row.user_id)?.lockedMonths.push(row.month.slice(0, 7));
      continue;
    }
    ingestReport(row.user_id, row.month, row.report);
  }

  const ingestPick = (ownerId: string, monthDate: string, kind: PickKind, readingId: string) => {
    const participant = participants.get(ownerId);
    if (participant === undefined) return;
    const month = monthDate.slice(0, 7);
    (participant.picksByMonth[month] ??= []).push({ kind, readingId });
  };
  // Mes picks incluent le mois COURANT — sans enjeu : l'UI n'affiche que les
  // mois portés par une ligne d'agrégat, et le mois courant n'en a jamais.
  for (const row of myPicks ?? []) ingestPick(userId, row.month, row.kind, row.reading_id);
  for (const row of friendPicks ?? []) ingestPick(row.user_id, row.month, row.kind, row.reading_id);

  return {
    joined,
    participants: [...participants.values()].sort((left, right) =>
      left.displayName.localeCompare(right.displayName, "fr", { sensitivity: "base" }),
    ),
    myManualReveals: (myReveals ?? []).map((row) => row.month.slice(0, 7)),
  };
}
