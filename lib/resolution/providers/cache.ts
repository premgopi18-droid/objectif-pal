import type { CacheEntry } from "@/lib/resolution/types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Le cache de résolutions (`barcode_cache`) — NOTRE table, celle qui grossit
 * toute seule : tout ce que la BnF, Google Books ou Metron ont résolu une
 * fois y reste pour toujours (specs §6). Jamais une résolution GCD : GCD est
 * déjà en base, et cette table-là survit aux refreshs du dump.
 */

type CacheRow = {
  barcode: string;
  title: string | null;
  series_name: string | null;
  issue_number: string | null;
  authors: string | null;
  publisher: string | null;
  page_count: number | null;
  cover_url: string | null;
  source: CacheEntry["source"];
  source_id: string | null;
};

export type CacheProvider = ReturnType<typeof createCacheProvider>;

export function createCacheProvider(client = createAdminClient()) {
  return {
    async get(barcode: string): Promise<CacheEntry | null> {
      const { data, error } = await client.from("barcode_cache").select("*").eq("barcode", barcode).limit(1);
      if (error) throw new Error(`barcode_cache get : ${error.message}`);
      const row = (data as CacheRow[])[0];
      if (!row) return null;
      return {
        barcode: row.barcode,
        title: row.title,
        seriesName: row.series_name,
        issueNumber: row.issue_number,
        authors: row.authors,
        publisher: row.publisher,
        pageCount: row.page_count,
        coverUrl: row.cover_url,
        source: row.source,
        sourceId: row.source_id,
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
        },
        { onConflict: "barcode" },
      );
      if (error) throw new Error(`barcode_cache set : ${error.message}`);
    },
  };
}
