import { EAN13_LENGTH } from "@/lib/resolution/barcode-router";
import { isHouseCoverPhotoUrl } from "@/lib/books/cover-photo";
import { isKnownCoverImageUrl } from "@/lib/books/cover-repair";
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
 *    un ISBN (le supplément est un prix), le code BRUT pour un UPC ;
 *  - la couverture n'entre au cache PARTAGÉ que si son hôte est un hôte de
 *    couvertures connu (#179) : une photo maison serait une REDISTRIBUTION
 *    (interdite — c'est l'argument juridique du §5.4/#33), et une URL
 *    arbitraire casserait la vignette de tous (hors remotePatterns). Le
 *    LIVRE de l'utilisateur garde sa couverture quoi qu'il arrive — seul le
 *    cache commun est protégé ;
 *  - `createdBy` trace l'auteur (#179) : une entrée douteuse redevient
 *    attribuable, corrigeable, annulable.
 */
export function manualEntryToCacheEntry(input: BookInput, createdBy: string): CacheEntry | null {
  if (input.metadataSource !== "manual" || !input.barcodeRaw) return null;
  const barcode = input.barcodeType === "isbn" ? (input.isbn ?? input.barcodeRaw.slice(0, EAN13_LENGTH)) : input.barcodeRaw;
  // isKnownCoverImageUrl exclut déjà l'hôte Supabase (pas dans l'allowlist) —
  // le test isHouseCoverPhotoUrl reste en ceinture-bretelles explicite : la
  // règle « jamais de photo maison dans le cache commun » ne doit pas dépendre
  // du contenu d'une allowlist qui évoluera.
  const shareableCoverUrl =
    input.coverUrl !== null && isKnownCoverImageUrl(input.coverUrl) && !isHouseCoverPhotoUrl(input.coverUrl)
      ? input.coverUrl
      : null;
  return {
    barcode,
    title: input.title.trim() || null,
    seriesName: input.seriesName,
    issueNumber: input.issueNumber,
    authors: input.authors,
    publisher: input.publisher,
    pageCount: input.pageCount,
    coverUrl: shareableCoverUrl,
    source: "manual",
    sourceId: null,
    createdBy,
  };
}
