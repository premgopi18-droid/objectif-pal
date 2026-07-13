import { resolveScannedCode } from "@/lib/resolution/resolve";

/**
 * GET /api/lookup/[barcode] — le point d'entrée unique du scan (specs §5.1) :
 * le code se route lui-même (ISBN vs UPC), la cascade fait le reste. Les
 * secrets (Metron, Google Books, service role) ne quittent jamais le serveur :
 * le client n'appelle que ce handler et reçoit un résultat normalisé (§8).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ barcode: string }> }) {
  const { barcode } = await params;
  const result = await resolveScannedCode(barcode);
  return Response.json(result, { status: result.kind === "invalid" ? 400 : 200 });
}
