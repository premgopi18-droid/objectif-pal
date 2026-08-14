import { sanitizePageCount, type CacheEntry } from "@/lib/resolution/types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Le cache de résolutions (`barcode_cache`) — NOTRE table, celle qui grossit
 * toute seule : tout ce que la BnF, Google Books ou Metron ont résolu une
 * fois y reste pour toujours (specs §6), et cette table-là survit aux
 * refreshs du dump. Les résolutions GCD y entrent aussi, mais UNIQUEMENT une
 * fois enrichies (couverture Metron / Google Books) : ce n'est pas la ligne
 * GCD qu'on cache — elle est déjà en base, gratuite — c'est son
 * ENRICHISSEMENT, qui coûte 2-3 appels réseau à chaque scan sinon.
 *
 * Les SAISIES MANUELLES rattachées à un code-barres y entrent aussi depuis
 * l'issue #55 (`source: "manual"`) : un livre qu'aucune base ne connaît n'est
 * saisi qu'une fois — le rescan (et demain, les autres utilisateurs) le
 * retrouve ici.
 */

export type CacheProvider = ReturnType<typeof createCacheProvider>;

export function createCacheProvider(client = createAdminClient()) {
  return {
    async get(barcode: string): Promise<CacheEntry | null> {
      const { data, error } = await client.from("barcode_cache").select("*").eq("barcode", barcode).limit(1);
      if (error) throw new Error(`barcode_cache get : ${error.message}`);
      const row = data[0];
      if (!row) return null;
      return {
        barcode: row.barcode,
        title: row.title,
        seriesName: row.series_name,
        issueNumber: row.issue_number,
        authors: row.authors,
        publisher: row.publisher,
        // Assaini à la LECTURE (#154) : les zéros déjà figés en cache guérissent ici.
        pageCount: sanitizePageCount(row.page_count),
        coverUrl: row.cover_url,
        source: row.source,
        sourceId: row.source_id,
        coverCheckedAt: row.cover_checked_at,
      };
    },

    async set(entry: CacheEntry): Promise<void> {
      const { error } = await client.from("barcode_cache").upsert(
        {
          barcode: entry.barcode,
          title: entry.title,
          series_name: entry.seriesName,
          issue_number: entry.issueNumber,
          authors: entry.authors,
          publisher: entry.publisher,
          page_count: entry.pageCount,
          cover_url: entry.coverUrl,
          source: entry.source,
          source_id: entry.sourceId,
          resolved_at: new Date().toISOString(),
          // Fourni seulement quand l'appelant a un verdict (#176) : l'upsert ne
          // touche pas aux colonnes absentes — un repair ou une saisie manuelle
          // ne doit pas effacer le tampon existant.
          ...(entry.coverCheckedAt !== undefined ? { cover_checked_at: entry.coverCheckedAt } : {}),
        },
        { onConflict: "barcode" },
      );
      if (error) throw new Error(`barcode_cache set : ${error.message}`);
    },

    /** Tamponne « chaîne couverture re-déroulée proprement, toujours rien » (#176). */
    async stampCoverChecked(barcode: string): Promise<void> {
      const { error } = await client
        .from("barcode_cache")
        .update({ cover_checked_at: new Date().toISOString() })
        .eq("barcode", barcode);
      if (error) throw new Error(`barcode_cache stampCoverChecked : ${error.message}`);
    },

    /** Le cache NÉGATIF (#176) : le dernier « aucune base ne connaît ce code ». */
    async getMiss(barcode: string): Promise<{ coverUrl: string | null; lastCheckedAt: string } | null> {
      const { data, error } = await client.from("barcode_misses").select("*").eq("barcode", barcode).limit(1);
      if (error) throw new Error(`barcode_misses get : ${error.message}`);
      const row = data[0];
      return row ? { coverUrl: row.cover_url, lastCheckedAt: row.last_checked_at } : null;
    },

    /**
     * Mémorise un introuvable PROPRE (cascade complète, aucune source en
     * panne) — avec l'image éventuellement trouvée chez les libraires (#55),
     * pour pré-remplir la saisie manuelle au rescan sans re-payer la chaîne.
     */
    async setMiss(barcode: string, coverUrl: string | null): Promise<void> {
      const { error } = await client
        .from("barcode_misses")
        .upsert({ barcode, cover_url: coverUrl, last_checked_at: new Date().toISOString() }, { onConflict: "barcode" });
      if (error) throw new Error(`barcode_misses set : ${error.message}`);
    },
  };
}
