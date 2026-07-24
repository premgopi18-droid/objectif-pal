import { findBookInLibrary } from "@/lib/books/library-lookup";
import { isLookupAllowed, LOOKUP_RATE_LIMIT_MESSAGE } from "@/lib/resolution/lookup-rate-limit";
import { resolveScannedCode } from "@/lib/resolution/resolve";
import { getSessionOrError } from "@/lib/supabase/server";

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
export async function GET(_request: Request, { params }: { params: Promise<{ barcode: string }> }) {
  const session = await getSessionOrError();
  if (!session) {
    return Response.json({ error: "authentification requise" }, { status: 401 });
  }
  // Le quota se consomme AVANT tout travail (issue #32) : le lookup
  // bibliothèque est gratuit, mais la cascade derrière ne l'est pas.
  if (!(await isLookupAllowed(session.supabase))) {
    return Response.json({ error: LOOKUP_RATE_LIMIT_MESSAGE }, { status: 429 });
  }
  const { barcode } = await params;

  const libraryMatch = await findBookInLibrary(session.supabase, session.user.id, barcode);
  if (libraryMatch) {
    return Response.json({
      kind: "in-library",
      book: libraryMatch.book,
      hasFinishedReading: libraryMatch.hasFinishedReading,
      isOwned: libraryMatch.isOwned,
    });
  }

  const result = await resolveScannedCode(barcode);
  return Response.json(result, { status: result.kind === "invalid" ? 400 : 200 });
}
