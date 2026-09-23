import { findBookInLibrary } from "@/lib/books/library-lookup";
import { findContributionCover, withContributionCover } from "@/lib/covers/contributions";
import { isLookupAllowed, LOOKUP_RATE_LIMIT_MESSAGE } from "@/lib/resolution/lookup-rate-limit";
import { createDefaultDeps, probeResolutionCache, resolveScannedCode } from "@/lib/resolution/resolve";
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
 *
 * `?defer=cover` (fluidité #332, item 3) : le scan UNITAIRE demande l'identité
 * d'abord — la réponse porte `coverPending`, l'image vient par
 * `/api/lookup/[barcode]/cover`. La rafale ne le demande pas : elle écrit le
 * livre dès la réponse, il lui faut l'image dedans.
 */

// La cascade a un budget de 7 s (RESOLUTION_BUDGET_MILLISECONDS, resolve.ts) : la durée par défaut de la
// plateforme pouvait tuer la fonction AVANT sa propre limite (#191) — le
// timeout applicatif doit toujours être plus court que celui de l'infra.
export const maxDuration = 20;

export async function GET(request: Request, { params }: { params: Promise<{ barcode: string }> }) {
  // Identité vérifiée LOCALEMENT (fluidité #332, item 4) : le `getUser()`
  // réseau mettait ~100-200 ms d'auth en série devant tout le reste, sur une
  // route de LECTURE que le proxy a déjà gardée.
  const session = await getClaimsSession();
  if (!session) {
    return Response.json({ error: "authentification requise" }, { status: 401 });
  }
  const { barcode } = await params;
  const deferCover = new URL(request.url).searchParams.get("defer") === "cover";

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

  const result = await resolveScannedCode(barcode, deps, probe, { deferCover });
  if (result.kind === "invalid") return Response.json(result, { status: 400 });

  // Le pool partagé (#278) : une contribution ne devient couverture par défaut
  // que si la cascade n'a rien — ici, APRÈS elle, sur le résultat rendu ; la
  // cascade seule écrit le cache, une contribution n'y entre jamais (#179).
  // Image DIFFÉRÉE (item 3) : la chaîne n'a pas encore parlé, le pool attend la
  // seconde phase — sinon il passerait devant une source.
  const isCoverPending = (result.kind === "resolved" || result.kind === "not-found") && result.coverPending === true;
  const needsCover =
    !isCoverPending &&
    ((result.kind === "resolved" && result.book.coverUrl === null) || (result.kind === "not-found" && result.coverUrl === null));
  const contribution = needsCover ? await findContributionCover(session.supabase, barcode) : null;
  return Response.json(withContributionCover(result, contribution));
}
