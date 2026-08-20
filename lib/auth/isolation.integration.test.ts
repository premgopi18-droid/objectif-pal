import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Le test de CLOISONNEMENT (Phase 1 « Objectif 100 », epic #182) — toute la
 * sécurité inter-utilisateurs repose sur la RLS, et l'audit du 14/08/2026 a
 * relevé qu'aucun test ne la prouvait : une régression de policy transformait
 * l'export en fuite totale, silencieusement.
 *
 * Deux comptes de TEST dédiés (créés via l'API admin, allowlistés, mot de
 * passe — jamais utilisés par un humain) écrivent et se lisent l'un l'autre :
 * tout ce que B obtient de A doit être VIDE. L'export (/api/export) n'a pas
 * de filtre applicatif : il repose sur exactement ces policies — les prouver
 * ici, c'est le prouver aussi.
 *
 * Opt-in comme le contrat #60 : INTEGRATION_ISOLATION=1 + les identifiants
 * dans l'environnement (.env.local). Idempotent : chaque compte upserte SON
 * unique livre-témoin (contrainte user_id+barcode_raw), rien ne s'accumule.
 */

const shouldRun =
  process.env.INTEGRATION_ISOLATION === "1" &&
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  !!process.env.ISOLATION_TEST_USER_A_EMAIL &&
  !!process.env.ISOLATION_TEST_USER_A_PASSWORD &&
  !!process.env.ISOLATION_TEST_USER_B_EMAIL &&
  !!process.env.ISOLATION_TEST_USER_B_PASSWORD;

/** Le code-barres témoin — un préfixe hors de tout vrai référentiel. */
const SENTINEL_BARCODE = "0000000000000";

async function signIn(email: string, password: string) {
  const client = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    { auth: { persistSession: false } },
  );
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`connexion impossible pour ${email} : ${error?.message}`);
  return { client, userId: data.user.id };
}

// 30 s comme le contrat #60 : ces tests enchaînent une douzaine d'allers-retours
// séquentiels vers la prod (runner GitHub aux US ↔ base en Europe) — le défaut
// Vitest de 5 s est structurellement trop juste un matin lent (échec du 17/08).
const INTEGRATION_TIMEOUT_MS = 30000;

describe.runIf(shouldRun)("cloisonnement inter-utilisateurs (RLS)", () => {
  it("A écrit ; B ne voit rien, ne modifie rien, ne raccroche rien", async () => {
    const a = await signIn(
      process.env.ISOLATION_TEST_USER_A_EMAIL as string,
      process.env.ISOLATION_TEST_USER_A_PASSWORD as string,
    );
    const b = await signIn(
      process.env.ISOLATION_TEST_USER_B_EMAIL as string,
      process.env.ISOLATION_TEST_USER_B_PASSWORD as string,
    );

    // A pose (ou retrouve) son livre-témoin.
    const { data: bookA, error: upsertError } = await a.client
      .from("books")
      .upsert(
        { user_id: a.userId, title: "Témoin de cloisonnement", category: "roman", barcode_raw: SENTINEL_BARCODE },
        { onConflict: "user_id,barcode_raw" },
      )
      .select("id")
      .single();
    expect(upsertError).toBeNull();
    if (!bookA) throw new Error("livre-témoin non créé");

    // B ne LIT pas le livre de A — ni par id, ni en balayant sa table.
    const { data: direct } = await b.client.from("books").select("id").eq("id", bookA.id);
    expect(direct).toEqual([]);
    const { data: sweep } = await b.client.from("books").select("id").eq("barcode_raw", SENTINEL_BARCODE).neq("user_id", b.userId);
    expect(sweep).toEqual([]);

    // B ne MODIFIE pas le livre de A (0 ligne touchée, pas d'erreur — la RLS filtre).
    const { data: updated } = await b.client.from("books").update({ title: "piraté" }).eq("id", bookA.id).select("id");
    expect(updated).toEqual([]);

    // B ne RACCROCHE pas une lecture au livre de A (le with check du parent refuse).
    const { error: crossInsert } = await b.client
      .from("readings")
      .insert({ user_id: b.userId, book_id: bookA.id, status: "reading", started_at: "2026-08-15" });
    expect(crossInsert).not.toBeNull();

    // Et le titre de A n'a pas bougé.
    const { data: intact } = await a.client.from("books").select("title").eq("id", bookA.id).single();
    expect(intact?.title).toBe("Témoin de cloisonnement");

    // Les tables sensibles au balayage : B n'y voit que SES lignes.
    // `monthly_reports` (les agrégats §4.14) est cloisonnée comme le reste :
    // un ami passe par la fonction dédiée, jamais par la table.
    for (const table of ["readings", "purchases", "ownerships", "scan_inbox", "monthly_picks", "monthly_reports"] as const) {
      const { data: rows, error } = await b.client.from(table).select("user_id").neq("user_id", b.userId);
      expect(error).toBeNull();
      expect(rows).toEqual([]);
    }
  }, INTEGRATION_TIMEOUT_MS);

  it("le cercle (§4.14) : un non-ami ne lit aucun agrégat, un ami ne lit QUE des agrégats", async () => {
    const a = await signIn(
      process.env.ISOLATION_TEST_USER_A_EMAIL as string,
      process.env.ISOLATION_TEST_USER_A_PASSWORD as string,
    );
    const b = await signIn(
      process.env.ISOLATION_TEST_USER_B_EMAIL as string,
      process.env.ISOLATION_TEST_USER_B_PASSWORD as string,
    );
    const [low, high] = a.userId < b.userId ? [a.userId, b.userId] : [b.userId, a.userId];

    // Idempotence : le lien d'une exécution précédente part d'abord (DELETE
    // permis aux deux membres — la sortie silencieuse de la spec).
    await a.client.from("friendships").delete().eq("user_low", low).eq("user_high", high);

    // NON-AMIS : les deux fonctions du cercle ne rendent RIEN d'AUTRUI à B.
    // (Depuis #252 elles servent aussi SES propres lignes — le mode
    // spectateur — donc l'assertion filtre : zéro ligne d'un autre compte.)
    const { data: reportsBefore, error: reportsBeforeError } = await b.client.rpc("get_circle_monthly_reports");
    expect(reportsBeforeError).toBeNull();
    expect((reportsBefore ?? []).filter((row) => row.user_id !== b.userId)).toEqual([]);
    const { data: picksBefore, error: picksBeforeError } = await b.client.rpc("get_circle_monthly_picks");
    expect(picksBeforeError).toBeNull();
    expect((picksBefore ?? []).filter((row) => row.user_id !== b.userId)).toEqual([]);

    // La porte (§4.14) : les deux comptes de test entrent au cercle — la
    // policy d'INSERT de `friendships` l'exige des deux côtés.
    const joinedAt = new Date().toISOString();
    await a.client.from("profiles").update({ circle_joined_at: joinedAt }).eq("id", a.userId);
    await b.client.from("profiles").update({ circle_joined_at: joinedAt }).eq("id", b.userId);

    // Le chemin réel : A demande, B (le destinataire) accepte.
    const { error: requestError } = await a.client
      .from("friendships")
      .insert({ user_low: low, user_high: high, requester_id: a.userId });
    expect(requestError).toBeNull();
    const { data: accepted, error: acceptError } = await b.client
      .from("friendships")
      .update({ status: "accepted", accepted_at: new Date().toISOString() })
      .eq("user_low", low)
      .eq("user_high", high)
      .eq("status", "pending")
      .select("id");
    expect(acceptError).toBeNull();
    expect(accepted?.length).toBe(1);

    // AMIS : B reçoit les agrégats de A (et les siens, #252) — JAMAIS ceux
    // d'un tiers.
    const { data: reportsAfter, error: reportsAfterError } = await b.client.rpc("get_circle_monthly_reports");
    expect(reportsAfterError).toBeNull();
    for (const row of reportsAfter ?? []) expect([a.userId, b.userId]).toContain(row.user_id);

    // LE MODE SPECTATEUR (#252) — la parité « moi vu par le cercle ≡ ce que
    // l'ami voit de moi », prouvée sur les deux états du verrou (#243).
    // A pose deux mois-témoins : un mois ANCIEN (auto-révélé, le prédicat de
    // temps) et le DERNIER mois clos (verrouillé : aucun reveal manuel dessus).
    const nowUtc = new Date();
    const lastClosedMonth = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth() - 1, 1))
      .toISOString()
      .slice(0, 10);
    // 2020-02 : auto-révélé par le temps, et JAMAIS touché par le bloc reveal
    // ci-dessous (qui, lui, révèle 2020-01 manuellement).
    const oldMonth = "2020-02-01";
    const witnessReport = (month: string) => ({
      report: {
        month: month.slice(0, 7),
        finishedByCategory: { roman: 1 },
        readingPoints: 5,
        unreadPurchaseCount: 0,
        purchasePenalty: 0,
        objective: null,
        total: 5,
      },
      finishedReadings: [],
    });
    for (const month of [oldMonth, lastClosedMonth]) {
      const { error: witnessError } = await a.client
        .from("monthly_reports")
        .upsert({ user_id: a.userId, month, report: witnessReport(month), fact_version: 1 }, { onConflict: "user_id,month" });
      expect(witnessError).toBeNull();
    }

    // Les deux regards sur les lignes de A : l'ami (B) et le spectateur (A).
    const { data: friendSees, error: friendSeesError } = await b.client.rpc("get_circle_monthly_reports");
    expect(friendSeesError).toBeNull();
    const { data: spectatorSees, error: spectatorSeesError } = await a.client.rpc("get_circle_monthly_reports");
    expect(spectatorSeesError).toBeNull();
    const servedRowsOfA = (rows: NonNullable<typeof friendSees>) =>
      rows
        .filter((row) => row.user_id === a.userId)
        .map(({ month, report, revealed }) => ({ month, report, revealed }))
        .sort((left, right) => left.month.localeCompare(right.month));
    // La parité mot pour mot : mêmes mois, mêmes données, même verrou.
    expect(servedRowsOfA(spectatorSees ?? [])).toEqual(servedRowsOfA(friendSees ?? []));
    // Et le verrou est DANS la vérité servie, aussi pour le propriétaire :
    // le dernier mois clos arrive sans sa donnée, l'ancien arrive en clair.
    const spectatorRows = servedRowsOfA(spectatorSees ?? []);
    const lockedRow = spectatorRows.find((row) => row.month === lastClosedMonth);
    expect(lockedRow?.revealed).toBe(false);
    expect(lockedRow?.report).toBeNull();
    const revealedRow = spectatorRows.find((row) => row.month === oldMonth);
    expect(revealedRow?.revealed).toBe(true);
    expect(revealedRow?.report).not.toBeNull();

    // L'amitié n'ouvre RIEN d'autre : les lectures brutes (notes, avis) de A
    // restent invisibles — c'est tout le principe « agrégats servis ».
    const { data: rawReadings, error: rawError } = await b.client
      .from("readings")
      .select("user_id")
      .neq("user_id", b.userId);
    expect(rawError).toBeNull();
    expect(rawReadings).toEqual([]);

    // LE REVEAL (#243) — sens unique, chacun le sien.
    // B ne révèle PAS un mois de A (RLS insert : user_id = soi).
    const { error: crossReveal } = await b.client
      .from("monthly_reveals")
      .insert({ user_id: a.userId, month: "2020-01-01" });
    expect(crossReveal).not.toBeNull();
    // A ne révèle PAS le mois COURANT (with check : mois clos seulement).
    const currentMonthFirst = `${new Date().toISOString().slice(0, 7)}-01`;
    const { error: currentReveal } = await a.client
      .from("monthly_reveals")
      .insert({ user_id: a.userId, month: currentMonthFirst });
    expect(currentReveal).not.toBeNull();
    // A révèle un mois clos — idempotent entre deux exécutions (23505 toléré :
    // il n'y a PAS de DELETE, c'est le sens unique).
    const { error: revealError } = await a.client
      .from("monthly_reveals")
      .insert({ user_id: a.userId, month: "2020-01-01" });
    expect(revealError === null || revealError.code === "23505").toBe(true);
    // L'irréversibilité est STRUCTURELLE : le delete de A sur SON reveal ne
    // touche aucune ligne (aucune policy), la ligne survit.
    await a.client.from("monthly_reveals").delete().eq("user_id", a.userId).eq("month", "2020-01-01");
    const { data: survived } = await a.client
      .from("monthly_reveals")
      .select("month")
      .eq("month", "2020-01-01");
    expect(survived?.length).toBe(1);
    // Et B ne voit pas les reveals de A (select own only).
    const { data: revealSweep, error: revealSweepError } = await b.client
      .from("monthly_reveals")
      .select("user_id")
      .neq("user_id", b.userId);
    expect(revealSweepError).toBeNull();
    expect(revealSweep).toEqual([]);

    // Nettoyage : le lien part, la porte se referme — rien ne s'accumule.
    // Les mois-témoins aussi (DELETE own : c'est un cache) — sinon le
    // « dernier mois clos » en laisserait un nouveau chaque mois.
    await a.client.from("monthly_reports").delete().eq("user_id", a.userId).in("month", [oldMonth, lastClosedMonth]);
    await b.client.from("friendships").delete().eq("user_low", low).eq("user_high", high);
    await a.client.from("profiles").update({ circle_joined_at: null }).eq("id", a.userId);
    await b.client.from("profiles").update({ circle_joined_at: null }).eq("id", b.userId);
  }, INTEGRATION_TIMEOUT_MS);
});

describe.runIf(!shouldRun)("cloisonnement inter-utilisateurs (RLS)", () => {
  it.skip("désactivé — INTEGRATION_ISOLATION=1 + identifiants de test requis", () => {});
});
