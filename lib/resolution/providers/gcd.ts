import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Le provider GCD — la table importée chez nous (specs §6) : zéro réseau,
 * zéro quota, quelques millisecondes. Identifie les comics VO (par code-barres
 * complet ou par préfixe) ET la BD franco-belge (par ISBN).
 */

/** `language_id` de GCD (table `stddata_language` du dump). */
export const GCD_LANGUAGE_FRENCH = 34;

export type GcdIssue = {
  gcdId: number;
  barcode: string | null;
  seriesId: number;
  number: string;
  pageCount: number | null;
  isbn: string | null;
  title: string | null;
};

export type GcdSeries = {
  id: number;
  name: string | null;
  format: string | null;
  publisher: string | null;
  languageId: number | null;
};

/** La ligne telle que la sélectionne ISSUE_COLUMNS — dérivée du schéma généré. */
type IssueRow = Pick<
  Database["public"]["Tables"]["gcd_issues"]["Row"],
  "gcd_id" | "barcode" | "series_id" | "number" | "page_count" | "isbn" | "title"
>;

/** Jamais attribué par GCD (ses ids commencent à 1) : la recherche de série rend « inconnue ». */
const UNKNOWN_SERIES_ID = 0;

// Notre table d'import ne porte pas les NOT NULL du schéma GCD d'origine
// (series_id et number y sont obligatoires) : on absorbe ici le NULL
// théorique plutôt que de le propager dans toute la cascade.
const toIssue = (row: IssueRow): GcdIssue => ({
  gcdId: row.gcd_id,
  barcode: row.barcode,
  seriesId: row.series_id ?? UNKNOWN_SERIES_ID,
  number: row.number ?? "",
  pageCount: row.page_count === null ? null : Math.round(Number(row.page_count)),
  isbn: row.isbn,
  title: row.title,
});

const ISSUE_COLUMNS = "gcd_id, barcode, series_id, number, page_count, isbn, title";

export type GcdProvider = ReturnType<typeof createGcdProvider>;

export function createGcdProvider(client = createAdminClient()) {
  return {
    /** Match exact sur le code complet (variante comprise) ou ses formes plus courtes. */
    async findIssuesByBarcode(codes: string[]): Promise<GcdIssue[]> {
      const { data, error } = await client.from("gcd_issues").select(ISSUE_COLUMNS).in("barcode", codes);
      if (error) throw new Error(`GCD findIssuesByBarcode : ${error.message}`);
      return data.map(toIssue);
    },

    /** Match par ISBN — c'est par là qu'arrive la BD franco-belge. */
    async findIssuesByIsbn(isbnCandidates: string[]): Promise<GcdIssue[]> {
      const { data, error } = await client.from("gcd_issues").select(ISSUE_COLUMNS).in("isbn", isbnCandidates);
      if (error) throw new Error(`GCD findIssuesByIsbn : ${error.message}`);
      return data.map(toIssue);
    },

    /**
     * Recherche par préfixe (les 12 premiers chiffres) — retrouve la série
     * quand le scan a raté le supplément. C'est ce que Metron ne sait pas faire.
     */
    async findIssuesByPrefix(prefix: string): Promise<GcdIssue[]> {
      const { data, error } = await client
        .from("gcd_issues")
        .select(ISSUE_COLUMNS)
        .eq("barcode_prefix", prefix)
        .limit(500);
      if (error) throw new Error(`GCD findIssuesByPrefix : ${error.message}`);
      return data.map(toIssue);
    },

    /** Une issue précise — utilisée après un choix dans une liste (pick). */
    async getIssueByGcdId(gcdId: number): Promise<GcdIssue | null> {
      const { data, error } = await client.from("gcd_issues").select(ISSUE_COLUMNS).eq("gcd_id", gcdId).limit(1);
      if (error) throw new Error(`GCD getIssueByGcdId : ${error.message}`);
      const row = data[0];
      return row ? toIssue(row) : null;
    },

    /** Les séries d'un lot d'issues (pas de FK déclarée : jointure manuelle). */
    async getSeriesByIds(seriesIds: number[]): Promise<Map<number, GcdSeries>> {
      if (seriesIds.length === 0) return new Map();
      const { data, error } = await client
        .from("gcd_series")
        .select("id, name, format, publisher, language_id")
        .in("id", [...new Set(seriesIds)]);
      if (error) throw new Error(`GCD getSeriesByIds : ${error.message}`);
      return new Map(
        data.map((row) => [
          row.id,
          { id: row.id, name: row.name, format: row.format, publisher: row.publisher, languageId: row.language_id },
        ]),
      );
    },
  };
}
