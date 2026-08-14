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
    for (const table of ["readings", "purchases", "ownerships", "scan_inbox", "monthly_picks"] as const) {
      const { data: rows, error } = await b.client.from(table).select("user_id").neq("user_id", b.userId);
      expect(error).toBeNull();
      expect(rows).toEqual([]);
    }
  });
});

describe.runIf(!shouldRun)("cloisonnement inter-utilisateurs (RLS)", () => {
  it.skip("désactivé — INTEGRATION_ISOLATION=1 + identifiants de test requis", () => {});
});
