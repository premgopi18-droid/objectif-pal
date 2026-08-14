import { toCsv } from "@/lib/export/csv";
import { fetchAllRows } from "@/lib/supabase/pagination";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * GET /api/export — TOUTES mes données, en un tap (specs §4.10) :
 * « mes données sont à moi et je peux partir avec ». Lignes supprimées en
 * douceur COMPRISES (ce sont les données de l'utilisateur, toutes), notes et
 * avis compris, journal d'événements compris.
 *
 *   /api/export                 → JSON complet (un seul fichier)
 *   /api/export?format=csv&table=books|readings|reading_events|purchases|ownerships
 *
 * Client SESSION : la RLS garantit qu'on n'exporte que SES données.
 */

// 9 tables paginées (#178) + sérialisation : à l'aise dans 30 s, et un compte
// pathologique doit échouer avant le plafond facturé de la plateforme (#191).
export const maxDuration = 30;

// Les colonnes sont listées explicitement : un export doit être stable, pas
// refléter par accident la prochaine colonne technique venue.
// L'annotation élargit `columns` en string : sans ça, le parseur de types de
// supabase-js tente d'analyser chaque littéral et rend un ParserError.
const EXPORT_TABLES: Record<
  | "books"
  | "readings"
  | "reading_events"
  | "purchases"
  | "ownerships"
  | "scan_inbox"
  | "monthly_objectives"
  | "objective_targets"
  | "monthly_picks",
  { columns: string; orderBy: string }
> = {
  books: {
    columns:
      "id, title, series_name, issue_number, authors, publisher, page_count, category, barcode_raw, barcode_type, barcode_prefix, isbn, cover_url, metadata_source, metadata_source_id, created_at, deleted_at",
    orderBy: "created_at",
  },
  readings: {
    columns: "id, book_id, status, started_at, finished_at, rating, comment, created_at, deleted_at",
    orderBy: "created_at",
  },
  reading_events: { columns: "id, reading_id, status, occurred_at", orderBy: "id" },
  purchases: { columns: "id, book_id, purchased_at, created_at, deleted_at", orderBy: "created_at" },
  // La possession déclarée (#101) : sans elle, l'export ne dirait pas quels
  // livres sont à moi — or « tout » veut dire tout (§4.10).
  ownerships: {
    columns: "id, book_id, owned_since, disposed_at, created_at, deleted_at",
    orderBy: "created_at",
  },
  // La boîte de finition (#101 lot C) : des scans captés avec leur intention,
  // pas encore devenus des livres — ce sont des données de l'utilisateur au
  // même titre que le reste. Le jsonb passe en JSON dans le CSV (escapeField).
  scan_inbox: {
    columns:
      "id, barcode_raw, barcode_type, cover_url, resolved_metadata, intent, owned_since, finished_at, status, created_at, completed_at, deleted_at",
    orderBy: "created_at",
  },
  monthly_objectives: { columns: "id, month, created_at", orderBy: "month" },
  objective_targets: { columns: "id, objective_id, category, target_count", orderBy: "id" },
  monthly_picks: { columns: "id, month, kind, reading_id, comment, created_at", orderBy: "month" },
};

type ExportTable = keyof typeof EXPORT_TABLES;

const isExportTable = (value: string): value is ExportTable => value in EXPORT_TABLES;

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "authentification requise" }, { status: 401 });
  }

  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "json";
  const today = new Date().toISOString().slice(0, 10);

  // Pas de filtre deleted_at : l'export inclut les lignes supprimées en douceur.
  // Paginé par fetchAllRows (#178) : PostgREST tronque à 1 000 lignes SANS
  // erreur — « toutes mes données » amputées en silence trahirait le §4.10.
  // L'id en clé de tri SECONDAIRE rend l'ordre total (donc les pages stables) :
  // created_at et month ne sont pas uniques.
  async function fetchTable(table: ExportTable) {
    const { columns, orderBy } = EXPORT_TABLES[table];
    return fetchAllRows(async (from, to) => {
      const { data, error } = await supabase
        .from(table)
        .select(columns)
        .order(orderBy, { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      if (error) throw new Error(`${table} : ${error.message}`);
      // Seul cast Supabase restant de l'app, et légitime : la sélection de
      // colonnes est DYNAMIQUE (une chaîne `string` par table — l'annotation de
      // EXPORT_TABLES l'élargit exprès), donc le parseur de types de supabase-js
      // ne peut pas en dériver la forme des lignes.
      return (data ?? []) as unknown as Record<string, unknown>[];
    });
  }

  try {
    if (format === "csv") {
      const table = url.searchParams.get("table") ?? "";
      if (!isExportTable(table)) {
        return Response.json({ error: `table inconnue — valeurs permises : ${Object.keys(EXPORT_TABLES).join(", ")}` }, { status: 400 });
      }
      const rows = await fetchTable(table);
      // En-têtes explicites : une table vide sort quand même sa ligne d'en-tête.
      const headers = EXPORT_TABLES[table].columns.split(", ");
      return new Response(toCsv(rows, headers), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="objectif-pal-${table}-${today}.csv"`,
        },
      });
    }

    const [
      books,
      readings,
      readingEvents,
      purchases,
      ownerships,
      scanInbox,
      monthlyObjectives,
      objectiveTargets,
      monthlyPicks,
    ] = await Promise.all([
      fetchTable("books"),
      fetchTable("readings"),
      fetchTable("reading_events"),
      fetchTable("purchases"),
      fetchTable("ownerships"),
      fetchTable("scan_inbox"),
      fetchTable("monthly_objectives"),
      fetchTable("objective_targets"),
      fetchTable("monthly_picks"),
    ]);

    const payload = {
      exported_at: new Date().toISOString(),
      application: "objectif-pal",
      user_id: user.id,
      books,
      readings,
      reading_events: readingEvents,
      purchases,
      ownerships,
      scan_inbox: scanInbox,
      monthly_objectives: monthlyObjectives,
      objective_targets: objectiveTargets,
      monthly_picks: monthlyPicks,
    };

    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="objectif-pal-export-${today}.json"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "export impossible";
    return Response.json({ error: message }, { status: 500 });
  }
}
