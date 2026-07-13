import { resolveGcdIssue } from "@/lib/resolution/resolve";
import { getAuthenticatedUser } from "@/lib/supabase/server";

/**
 * GET /api/lookup/gcd/[gcdId] — le second temps des parcours « pick » :
 * quand le préfixe a rendu une liste (série ou numéro à choisir), le tap de
 * l'utilisateur revient ici avec le gcd_id précis, et on renvoie le livre
 * complet, couverture Metron comprise. Session obligatoire, comme le premier temps.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ gcdId: string }> }) {
  if (!(await getAuthenticatedUser())) {
    return Response.json({ error: "authentification requise" }, { status: 401 });
  }
  const { gcdId } = await params;
  const numericId = Number(gcdId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return Response.json({ kind: "invalid" }, { status: 400 });
  }
  const result = await resolveGcdIssue(numericId);
  return Response.json(result, { status: 200 });
}
