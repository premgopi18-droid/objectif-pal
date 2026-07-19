import { EAN13_LENGTH } from "@/lib/resolution/barcode-router";
import type { CacheEntry } from "@/lib/resolution/types";
import type { BookInput } from "@/lib/books/actions";

/**
 * La saisie manuelle qui alimente `barcode_cache` (issue #55) : un livre
 * qu'aucune base ne connaît n'est saisi qu'une fois — le rescan (et demain,
 * les autres utilisateurs) le retrouve au premier cran de la cascade.
 *
 * Fonction PURE : décide quoi cacher, pas comment. Les règles :
 *  - seule une saisie MANUELLE rattachée à un CODE-BARRES est cacheable
 *    (une création libre n'a pas de clé de cache) ;
 *  - la clé suit la normalisation de la cascade (specs §5.1) : l'EAN-13 pour
 *    un ISBN (le supplément est un prix), le code BRUT pour un UPC.
 */
export function manualEntryToCacheEntry(input: BookInput): CacheEntry | null {
  if (input.metadataSource !== "manual" || !input.barcodeRaw) return null;
  const barcode = input.barcodeType === "isbn" ? (input.isbn ?? input.barcodeRaw.slice(0, EAN13_LENGTH)) : input.barcodeRaw;
  return {
    barcode,
    title: input.title.trim() || null,
    seriesName: input.seriesName,
    issueNumber: input.issueNumber,
    authors: input.authors,
    publisher: input.publisher,
    pageCount: input.pageCount,
    coverUrl: input.coverUrl,
    source: "manual",
    sourceId: null,
  };
}
