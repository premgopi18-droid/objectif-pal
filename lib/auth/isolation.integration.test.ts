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

/**
 * Le verrou du choix de couverture (#275) côté BASE — ce que les tests
 * unitaires ne peuvent pas prouver : la fusion `merge_books` transfère la
 * couverture CHOISIE du doublon absorbé, et le trigger dédié ne périme les
 * bilans que pour une couverture choisie. Idempotent : le doublon absorbé est
 * ressuscité en fin de test (UPDATE own), rien ne s'accumule.
 */
describe.runIf(shouldRun)("le choix de couverture en base (#275)", () => {
  const MERGED_TITLE = "Témoin de fusion (absorbé)";
  const CHOSEN_COVER = "https://covers.openlibrary.org/b/isbn/0000000000000-L.jpg";

  it("merge_books : la couverture choisie du doublon absorbé gagne sur l'automatique du conservé", async () => {
    const a = await signIn(
      process.env.ISOLATION_TEST_USER_A_EMAIL as string,
      process.env.ISOLATION_TEST_USER_A_PASSWORD as string,
    );

    // Le conservé : le livre-témoin, couverture automatique (aucune).
    const { data: keep, error: keepError } = await a.client
      .from("books")
      .upsert(
        { user_id: a.userId, title: "Témoin de cloisonnement", category: "roman", barcode_raw: SENTINEL_BARCODE, deleted_at: null, cover_url: null, cover_chosen_at: null },
        { onConflict: "user_id,barcode_raw" },
      )
      .select("id")
      .single();
    expect(keepError).toBeNull();
    if (!keep) throw new Error("livre conservé non créé");

    // L'absorbé : sans code-barres (merge_books refuse deux codes différents),
    // retrouvé par son titre d'une exécution à l'autre, couverture CHOISIE.
    const chosenAt = new Date().toISOString();
    const { data: existing } = await a.client.from("books").select("id").eq("user_id", a.userId).eq("title", MERGED_TITLE).limit(1);
    let mergedId = existing?.[0]?.id ?? null;
    if (mergedId === null) {
      const { data: inserted, error: insertError } = await a.client
        .from("books")
        .insert({ user_id: a.userId, title: MERGED_TITLE, category: "roman", cover_url: CHOSEN_COVER, cover_chosen_at: chosenAt })
        .select("id")
        .single();
      expect(insertError).toBeNull();
      mergedId = inserted?.id ?? null;
    } else {
      const { error: reviveError } = await a.client
        .from("books")
        .update({ deleted_at: null, barcode_raw: null, barcode_type: null, barcode_prefix: null, cover_url: CHOSEN_COVER, cover_chosen_at: chosenAt })
        .eq("id", mergedId);
      expect(reviveError).toBeNull();
    }
    if (mergedId === null) throw new Error("doublon absorbé non créé");

    const { error: mergeError } = await a.client.rpc("merge_books", { keep_book_id: keep.id, merge_book_id: mergedId });
    expect(mergeError).toBeNull();

    const { data: after } = await a.client.from("books").select("cover_url, cover_chosen_at").eq("id", keep.id).single();
    expect(after?.cover_url).toBe(CHOSEN_COVER);
    expect(after?.cover_chosen_at).not.toBeNull();

    // Nettoyage : le conservé redevient automatique, l'absorbé ressuscite pour la prochaine fois.
    await a.client.from("books").update({ cover_url: null, cover_chosen_at: null }).eq("id", keep.id);
    await a.client.from("books").update({ deleted_at: null }).eq("id", mergedId);
  }, INTEGRATION_TIMEOUT_MS);

  it("le trigger : changer une couverture automatique ne périme rien, choisir une couverture périme", async () => {
    const a = await signIn(
      process.env.ISOLATION_TEST_USER_A_EMAIL as string,
      process.env.ISOLATION_TEST_USER_A_PASSWORD as string,
    );
    const { data: book } = await a.client
      .from("books")
      .upsert(
        { user_id: a.userId, title: "Témoin de cloisonnement", category: "roman", barcode_raw: SENTINEL_BARCODE, deleted_at: null, cover_url: null, cover_chosen_at: null },
        { onConflict: "user_id,barcode_raw" },
      )
      .select("id")
      .single();
    if (!book) throw new Error("livre-témoin non créé");

    const readVersion = async () => {
      const { data } = await a.client.from("user_fact_versions").select("version").eq("user_id", a.userId).maybeSingle();
      return data?.version ?? 1;
    };

    const baseline = await readVersion();
    // Automatique → automatique (ce que fait le job #208 chaque nuit) : rien ne bouge.
    await a.client.from("books").update({ cover_url: CHOSEN_COVER }).eq("id", book.id);
    expect(await readVersion()).toBe(baseline);
    // Un CHOIX : le cercle doit voir la nouvelle couverture (#236).
    await a.client.from("books").update({ cover_chosen_at: new Date().toISOString() }).eq("id", book.id);
    const afterChoice = await readVersion();
    expect(afterChoice).toBeGreaterThan(baseline);

    // Nettoyage (bumpe une fois de plus : old.cover_chosen_at non nul — voulu).
    await a.client.from("books").update({ cover_url: null, cover_chosen_at: null }).eq("id", book.id);
  }, INTEGRATION_TIMEOUT_MS);
});

/**
 * Le pool partagé de couvertures (#278) — l'EXCEPTION voulue au cloisonnement :
 * B lit la contribution de A (c'est le but), étiquetée au pseudo seulement si
 * A a rejoint le cercle ; mais B n'écrit ni ne modifie rien au nom de A, et le
 * retrait doux de A la fait disparaître pour B. Idempotent (upsert + nettoyage).
 */
describe.runIf(shouldRun)("le pool partagé de couvertures (#278)", () => {
  const POOL_BARCODE = "0000000000278";
  const OTHER_BARCODE = "0000000000279";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  // La forme exacte qu'exige le CHECK (audit #274) : notre bucket, le dossier
  // commun, LE code de la ligne, un uuid.
  const sharedUrlFor = (barcode: string) => `${supabaseUrl}/storage/v1/object/public/covers/shared/${barcode}/${crypto.randomUUID()}.webp`;
  const sharedUrl = sharedUrlFor(POOL_BARCODE);

  it("A partage ; B lit (anonyme hors cercle), ne modifie pas, ne s'approprie pas ; A retire, B ne voit plus", async () => {
    const a = await signIn(
      process.env.ISOLATION_TEST_USER_A_EMAIL as string,
      process.env.ISOLATION_TEST_USER_A_PASSWORD as string,
    );
    const b = await signIn(
      process.env.ISOLATION_TEST_USER_B_EMAIL as string,
      process.env.ISOLATION_TEST_USER_B_PASSWORD as string,
    );
    await a.client.from("profiles").update({ circle_joined_at: null }).eq("id", a.userId);

    // A pose (ou ravive) sa contribution-témoin — une URL du dossier commun, comme le serveur l'écrirait.
    const { error: upsertError } = await a.client
      .from("cover_contributions")
      .upsert(
        { user_id: a.userId, barcode: POOL_BARCODE, cover_url: sharedUrl, source_cover_url: `${supabaseUrl}/storage/v1/object/public/covers/${a.userId}/temoin.webp`, deleted_at: null },
        { onConflict: "barcode,user_id" },
      );
    expect(upsertError).toBeNull();

    // B la LIT via la fonction — anonyme : A n'a pas rejoint le cercle, son pseudo ne sort pas.
    const { data: seenByB, error: rpcError } = await b.client.rpc("get_cover_contributions", { target_barcode: POOL_BARCODE });
    expect(rpcError).toBeNull();
    expect(seenByB?.map((row) => [row.cover_url, row.contributor_label])).toEqual([[sharedUrl, null]]);
    // A ne se voit pas elle-même dans la fonction (les AUTRES seulement).
    const { data: seenByA } = await a.client.rpc("get_cover_contributions", { target_barcode: POOL_BARCODE });
    expect(seenByA).toEqual([]);

    // B ne LIT pas la ligne de A par la table (audit #274 : seule la fonction sert les autres).
    const { data: direct } = await b.client.from("cover_contributions").select("id").eq("user_id", a.userId);
    expect(direct).toEqual([]);

    // B ne s'approprie pas la ligne de A (RLS 42501 — l'URL est conforme au CHECK,
    // pour que ce soit bien la RLS qui refuse), ne la modifie pas (0 ligne), ne la
    // supprime pas (pas de policy).
    const { error: crossInsert } = await b.client
      .from("cover_contributions")
      .insert({ user_id: a.userId, barcode: OTHER_BARCODE, cover_url: sharedUrlFor(OTHER_BARCODE), source_cover_url: sharedUrl });
    expect(crossInsert?.code).toBe("42501");
    const { data: updated } = await b.client.from("cover_contributions").update({ deleted_at: new Date().toISOString() }).eq("user_id", a.userId).eq("barcode", POOL_BARCODE).select("id");
    expect(updated).toEqual([]);
    const { data: deleted } = await b.client.from("cover_contributions").delete().eq("user_id", a.userId).eq("barcode", POOL_BARCODE).select("id");
    expect(deleted).toEqual([]);
    // Le CHECK (23514) : une URL hors du dossier commun, ou du dossier d'un AUTRE
    // code, ou avec le chemin caché en query, est refusée — même pour soi.
    for (const forged of [
      `${supabaseUrl}/storage/v1/object/public/covers/${b.userId}/x.webp`,
      sharedUrlFor(POOL_BARCODE),
      `https://evil.example/pixel.png?x=/storage/v1/object/public/covers/shared/${OTHER_BARCODE}/`,
    ]) {
      const { error: badUrl } = await b.client
        .from("cover_contributions")
        .insert({ user_id: b.userId, barcode: OTHER_BARCODE, cover_url: forged, source_cover_url: sharedUrl });
      expect(badUrl?.code).toBe("23514");
    }
    // Les colonnes techniques sont hors de portée (grants par colonne) : 42501.
    const { error: forgedDate } = await b.client
      .from("cover_contributions")
      .insert({ user_id: b.userId, barcode: OTHER_BARCODE, cover_url: sharedUrlFor(OTHER_BARCODE), source_cover_url: sharedUrl, created_at: "2999-01-01T00:00:00Z" });
    expect(forgedDate?.code).toBe("42501");

    // A retire (doux) : B ne la voit plus. A, elle, relit sa ligne retirée (export, re-partage).
    const { error: withdrawError } = await a.client.from("cover_contributions").update({ deleted_at: new Date().toISOString() }).eq("user_id", a.userId).eq("barcode", POOL_BARCODE);
    expect(withdrawError).toBeNull();
    const { data: afterWithdraw } = await b.client.rpc("get_cover_contributions", { target_barcode: POOL_BARCODE });
    expect(afterWithdraw).toEqual([]);
    const { data: ownWithdrawn } = await a.client.from("cover_contributions").select("deleted_at").eq("user_id", a.userId).eq("barcode", POOL_BARCODE);
    expect(ownWithdrawn?.[0]?.deleted_at).not.toBeNull();
  }, INTEGRATION_TIMEOUT_MS);
});

/**
 * Le référentiel partagé de séries (#291, §4.17) — la seconde exception voulue
 * au cloisonnement : la SÉRIE (nom, total déclaré, historique) est commune et
 * lisible par tous ; ce qui reste cloisonné, c'est le LIEN livre → série et
 * les livres eux-mêmes. Écriture uniquement par RPC : la table refuse tout
 * accès direct, même à l'auteur. Idempotent : le nom-témoin retombe sur la
 * même ligne à chaque run (c'est précisément la propriété testée) ; deux
 * `series_events` s'ajoutent par run (les deux déclarations), et trois ticks
 * du quota `series_write` (30/min) sont consommés — rejouer le test plus de
 * dix fois dans la minute échoue sur « Trop de modifications ». (review #295)
 */
describe.runIf(shouldRun)("le référentiel partagé de séries (#291)", () => {
  const SERIES_NAME = "Série témoin isolation #291";
  const SERIES_GCD_ID = "999999291"; // hors de tout vrai référentiel
  const BOOK_BARCODE = "0000000000291";

  it("A crée et déclare ; B lit la série et l'historique, ne touche pas la table, ne relie pas le livre de A, mais déclare aussi (fait partagé)", async () => {
    const a = await signIn(
      process.env.ISOLATION_TEST_USER_A_EMAIL as string,
      process.env.ISOLATION_TEST_USER_A_PASSWORD as string,
    );
    const b = await signIn(
      process.env.ISOLATION_TEST_USER_B_EMAIL as string,
      process.env.ISOLATION_TEST_USER_B_PASSWORD as string,
    );

    // A rattache (trouve ou crée) la série-témoin, avec un identifiant GCD.
    const { data: seriesId, error: createError } = await a.client.rpc("find_or_create_series", {
      p_name: SERIES_NAME,
      p_category: "bd",
      p_gcd_series_id: SERIES_GCD_ID,
    });
    expect(createError).toBeNull();
    expect(seriesId).toBeTruthy();

    // B, avec une autre CASSE et des espaces, retombe sur la MÊME ligne : c'est le but du référentiel.
    const { data: sameSeriesId } = await b.client.rpc("find_or_create_series", {
      p_name: `  ${SERIES_NAME.toUpperCase()}  `,
      p_category: "bd",
    });
    expect(sameSeriesId).toBe(seriesId);

    // A déclare un total ; B le LIT (référentiel commun), avec l'auteur.
    const { error: declareError } = await a.client.rpc("declare_series_fact", { p_series_id: seriesId as string, p_total_volumes: 12 });
    expect(declareError).toBeNull();
    const { data: seenByB } = await b.client.from("series").select("name, total_volumes, is_ongoing, fact_declared_by").eq("id", seriesId as string);
    expect(seenByB).toEqual([{ name: SERIES_NAME, total_volumes: 12, is_ongoing: false, fact_declared_by: a.userId }]);
    const { data: eventsSeenByB } = await b.client.from("series_events").select("kind, user_id").eq("series_id", seriesId as string).eq("kind", "declare_total");
    expect(eventsSeenByB?.some((event) => event.user_id === a.userId)).toBe(true);

    // La table ne s'écrit PAS directement — même pour l'auteur : aucune policy d'écriture.
    const { error: directInsert } = await a.client.from("series").insert({ name: "Intrus", name_normalized: "intrus", category: "bd" });
    expect(directInsert?.code).toBe("42501");
    const { data: directUpdate } = await b.client.from("series").update({ total_volumes: 99 }).eq("id", seriesId as string).select("id");
    expect(directUpdate).toEqual([]);
    const { data: directDelete } = await b.client.from("series").delete().eq("id", seriesId as string).select("id");
    expect(directDelete).toEqual([]);
    const { error: eventInsert } = await b.client.from("series_events").insert({ series_id: seriesId as string, kind: "rename", user_id: b.userId });
    expect(eventInsert?.code).toBe("42501");

    // A a un livre ; B ne peut pas le relier (la RPC ne voit que ses propres livres).
    const { data: aBook, error: bookError } = await a.client
      .from("books")
      .upsert(
        { user_id: a.userId, title: "Tome témoin #291", category: "bd", barcode_raw: BOOK_BARCODE, barcode_type: "isbn", metadata_source: "manual", deleted_at: null },
        { onConflict: "user_id,barcode_raw" },
      )
      .select("id")
      .single();
    expect(bookError).toBeNull();
    const { error: crossLink } = await b.client.rpc("link_book_series", { p_book_id: aBook!.id, p_series_id: seriesId as string });
    expect(crossLink?.message).toContain("UX: Livre introuvable");
    const { error: ownLink } = await a.client.rpc("link_book_series", { p_book_id: aBook!.id, p_series_id: seriesId as string });
    expect(ownLink).toBeNull();
    // Le livre de A, relié, reste invisible pour B.
    const { data: aBooksSeenByB } = await b.client.from("books").select("id").eq("series_id", seriesId as string).eq("user_id", a.userId);
    expect(aBooksSeenByB).toEqual([]);

    // Le fait est partagé et modifiable par tous (§4.17-3) : B déclare « parution en cours », A le voit.
    const { error: bDeclare } = await b.client.rpc("declare_series_fact", { p_series_id: seriesId as string, p_is_ongoing: true });
    expect(bDeclare).toBeNull();
    const { data: seenByA } = await a.client.from("series").select("total_volumes, is_ongoing, fact_declared_by").eq("id", seriesId as string);
    expect(seenByA).toEqual([{ total_volumes: null, is_ongoing: true, fact_declared_by: b.userId }]);
    // Et l'historique garde la valeur d'avant (ajout seul) — la ligne de A n'a pas bougé.
    const { data: history } = await a.client.from("series_events").select("kind, total_volumes, user_id").eq("series_id", seriesId as string).order("created_at", { ascending: false }).limit(2);
    expect(history?.map((event) => event.kind)).toEqual(["declare_ongoing", "declare_total"]);

    // Une série à identifiant GCD DIFFÉRENT ne se fusionne pas avec celle-ci (deux séries, pas une graphie).
    const { data: otherId } = await a.client.rpc("find_or_create_series", { p_name: `${SERIES_NAME} (autre)`, p_category: "bd", p_gcd_series_id: "999999292" });
    const { error: mergeError } = await a.client.rpc("merge_series", { keep_series_id: seriesId as string, merge_series_id: otherId as string });
    expect(mergeError?.message).toContain("UX: Ces deux séries sont deux séries différentes chez GCD");
  }, INTEGRATION_TIMEOUT_MS);
});

describe.runIf(!shouldRun)("cloisonnement inter-utilisateurs (RLS)", () => {
  it.skip("désactivé — INTEGRATION_ISOLATION=1 + identifiants de test requis", () => {});
});
