import { findContributionCover } from "@/lib/covers/contributions";
import { isLookupAllowed, LOOKUP_RATE_LIMIT_MESSAGE } from "@/lib/resolution/lookup-rate-limit";
import { createDefaultDeps, resolveDeferredCover } from "@/lib/resolution/resolve";
import { getClaimsSession } from "@/lib/supabase/server";

/**
 * GET /api/lookup/[barcode]/cover — la SECONDE phase du scan unitaire
 * (fluidité #332, item 3) : l'identité a déjà été rendue par
 * `/api/lookup/[barcode]?defer=cover`, la feuille d'actions est à l'écran ;
 * ici la chaîne couverture (Google Books → replis) tourne pendant que
 * l'utilisateur lit la fiche, puis le pool partagé (#278) si rien. Le cache
 * est mis à jour comme si la cascade avait tout fait d'un coup.
 *
 * Sous le MÊME quota que le lookup (60/min) : un scan unitaire en consomme
 * deux, soit trente scans par minute — hors de portée d'un humain, et la
 * rafale, elle, ne différe jamais.
 */
export const maxDuration = 20;

export async function GET(_request: Request, { params }: { params: Promise<{ barcode: string }> }) {
  const session = await getClaimsSession();
  if (!session) {
    return Response.json({ error: "authentification requise" }, { status: 401 });
  }
  if (!(await isLookupAllowed(session.supabase))) {
    return Response.json({ error: LOOKUP_RATE_LIMIT_MESSAGE }, { status: 429 });
  }
  const { barcode } = await params;
  const coverUrl =
    (await resolveDeferredCover(barcode, createDefaultDeps())) ?? (await findContributionCover(session.supabase, barcode));
  return Response.json({ coverUrl });
}
