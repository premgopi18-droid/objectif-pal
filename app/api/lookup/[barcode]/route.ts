import { findBookInLibrary } from "@/lib/books/library-lookup";
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
  const { barcode } = await params;

  const libraryBook = await findBookInLibrary(session.supabase, session.user.id, barcode);
  if (libraryBook) {
    return Response.json({ kind: "in-library", book: libraryBook });
  }

  const result = await resolveScannedCode(barcode);
  return Response.json(result, { status: result.kind === "invalid" ? 400 : 200 });
}
