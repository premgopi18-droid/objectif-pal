import { isLookupAllowed, LOOKUP_RATE_LIMIT_MESSAGE } from "@/lib/resolution/lookup-rate-limit";
import { resolveGcdIssue } from "@/lib/resolution/resolve";
import { getSessionOrError } from "@/lib/supabase/server";

/**
 * GET /api/lookup/gcd/[gcdId] — le second temps des parcours « pick » :
 * quand le préfixe a rendu une liste (série ou numéro à choisir), le tap de
 * l'utilisateur revient ici avec le gcd_id précis, et on renvoie le livre
 * complet, couverture Metron comprise. Session obligatoire, comme le premier
 * temps — et même quota (issue #32) : ce chemin déclenche aussi Metron.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ gcdId: string }> }) {
  const session = await getSessionOrError();
  if (!session) {
    return Response.json({ error: "authentification requise" }, { status: 401 });
  }
  if (!(await isLookupAllowed(session.supabase))) {
    return Response.json({ error: LOOKUP_RATE_LIMIT_MESSAGE }, { status: 429 });
  }
  const { gcdId } = await params;
  const numericId = Number(gcdId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return Response.json({ kind: "invalid" }, { status: 400 });
  }
  const result = await resolveGcdIssue(numericId);
  return Response.json(result, { status: 200 });
}
