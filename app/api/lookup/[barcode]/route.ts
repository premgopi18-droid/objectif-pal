import { isSharedCoverUrl } from "@/lib/books/cover-photo";
import { findBookInLibrary } from "@/lib/books/library-lookup";
import { withContributionCover } from "@/lib/covers/contributions";
import { classifyScannedCode } from "@/lib/resolution/barcode-router";
import { isLookupAllowed, LOOKUP_RATE_LIMIT_MESSAGE } from "@/lib/resolution/lookup-rate-limit";
import { createDefaultDeps, probeResolutionCache, resolveScannedCode } from "@/lib/resolution/resolve";
import type { ScanLookupResult } from "@/lib/resolution/types";
import { getClaimsSession } from "@/lib/supabase/server";

/**
 * GET /api/lookup/[barcode] — le point d'entrée unique du scan (specs §5.1) :
 * le code se route lui-même (ISBN vs UPC), la cascade fait le reste. Les
 * secrets (Metron, Google Books, service role) ne quittent jamais le serveur :
 * le client n'appelle que ce handler et reçoit un résultat normalisé (§8).
 *
 * Session obligatoire AVANT tout travail : la cascade consomme des quotas
 * externes et écrit dans barcode_cache en service-role — pas pour les anonymes.
 *
 * La bibliothèque de l'utilisateur passe AVANT la cascade (issue #10) : un
 * livre déjà enregistré — même un indé introuvable dans toutes les sources —
 * revient directement, sans appel externe, avec la mention « déjà là ».
 */

// La cascade a un budget de 7 s (RESOLUTION_BUDGET_MILLISECONDS, resolve.ts) : la durée par défaut de la
// plateforme pouvait tuer la fonction AVANT sa propre limite (#191) — le
// timeout applicatif doit toujours être plus court que celui de l'infra.
export const maxDuration = 20;

export async function GET(_request: Request, { params }: { params: Promise<{ barcode: string }> }) {
  // Identité vérifiée LOCALEMENT (fluidité #332, item 4) : le `getUser()`
  // réseau mettait ~100-200 ms d'auth en série devant tout le reste, sur une
  // route de LECTURE que le proxy a déjà gardée.
  const session = await getClaimsSession();
  if (!session) {
    return Response.json({ error: "authentification requise" }, { status: 401 });
  }
  const { barcode } = await params;

  // UN SEUL étage (item 4) : le quota, la bibliothèque et la sonde du cache
  // partent ensemble — un hit de cache ou un livre déjà là ne coûte plus quatre
  // allers-retours en série. Le quota reste consommé AVANT tout travail
  // EXTERNE (issue #32) : la cascade, seule à coûter, attend son verdict ; la
  // bibliothèque et le cache sont chez nous, gratuits.
  // UN jeu de dépendances par requête (review #344), partagé par la sonde et la cascade.
  const deps = createDefaultDeps();
  const [allowed, libraryMatch, probe] = await Promise.all([
    isLookupAllowed(session.supabase),
    findBookInLibrary(session.supabase, session.userId, barcode),
    probeResolutionCache(barcode, deps),
  ]);
  if (!allowed) {
    return Response.json({ error: LOOKUP_RATE_LIMIT_MESSAGE }, { status: 429 });
  }

  if (libraryMatch) {
    return Response.json({
      kind: "in-library",
      book: libraryMatch.book,
      hasFinishedReading: libraryMatch.hasFinishedReading,
      isOwned: libraryMatch.isOwned,
    });
  }

  const result = await resolveScannedCode(barcode, deps, probe);
  // Le pool partagé (#278) : une contribution ne devient couverture par défaut
  // que si la cascade n'a rien — ici, APRÈS elle, sur le résultat rendu ; la
  // cascade seule écrit le cache, une contribution n'y entre jamais (#179).
  const withContribution = await applyContributionCover(session.supabase, barcode, result);
  return Response.json(withContribution, { status: withContribution.kind === "invalid" ? 400 : 200 });
}

async function applyContributionCover(
  supabase: NonNullable<Awaited<ReturnType<typeof getClaimsSession>>>["supabase"],
  raw: string,
  result: ScanLookupResult,
): Promise<ScanLookupResult> {
  const needsCover = (result.kind === "resolved" && result.book.coverUrl === null) || (result.kind === "not-found" && result.coverUrl === null);
  if (!needsCover) return result;
  const code = classifyScannedCode(raw);
  if (code.type === "invalid") return result;
  const { data, error } = await supabase.rpc("get_cover_contributions", { target_barcode: code.raw });
  if (error) {
    console.error("[lookup] get_cover_contributions:", error.message);
    return result;
  }
  // Défense en profondeur (audit #274) : seule une URL du dossier commun peut
  // devenir la couverture par défaut de quelqu'un, quoi que la table contienne.
  const contribution = (data ?? []).find((row) => isSharedCoverUrl(row.cover_url));
  return withContributionCover(result, contribution?.cover_url ?? null);
}
