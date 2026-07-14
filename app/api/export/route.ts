import { toCsv } from "@/lib/export/csv";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * GET /api/export — TOUTES mes données, en un tap (specs §4.10) :
 * « mes données sont à moi et je peux partir avec ». Lignes supprimées en
 * douceur COMPRISES (ce sont les données de l'utilisateur, toutes), notes et
 * avis compris, journal d'événements compris.
 *
 *   /api/export                 → JSON complet (un seul fichier)
 *   /api/export?format=csv&table=books|readings|reading_events|purchases
 *
 * Client SESSION : la RLS garantit qu'on n'exporte que SES données.
 */

// Les colonnes sont listées explicitement : un export doit être stable, pas
// refléter par accident la prochaine colonne technique venue.
// L'annotation élargit `columns` en string : sans ça, le parseur de types de
// supabase-js tente d'analyser chaque littéral et rend un ParserError.
const EXPORT_TABLES: Record<"books" | "readings" | "reading_events" | "purchases", { columns: string; orderBy: string }> = {
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
  // TODO(P1) : ajouter monthly_objectives, objective_targets et monthly_picks
  // dès qu'ils portent des données — le §4.10 les liste, un export incomplet
  // serait un trou silencieux dans la portabilité.
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
  async function fetchTable(table: ExportTable) {
    const { columns, orderBy } = EXPORT_TABLES[table];
    const { data, error } = await supabase.from(table).select(columns).order(orderBy, { ascending: true });
    if (error) throw new Error(`${table} : ${error.message}`);
    // Sans schéma typé généré, supabase-js rend GenericStringError[] pour une
    // sélection dynamique : le double cast est le passage obligé.
    return (data ?? []) as unknown as Record<string, unknown>[];
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

    const [books, readings, readingEvents, purchases] = await Promise.all([
      fetchTable("books"),
      fetchTable("readings"),
      fetchTable("reading_events"),
      fetchTable("purchases"),
    ]);

    const payload = {
      exported_at: new Date().toISOString(),
      application: "objectif-pal",
      user_id: user.id,
      books,
      readings,
      reading_events: readingEvents,
      purchases,
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
