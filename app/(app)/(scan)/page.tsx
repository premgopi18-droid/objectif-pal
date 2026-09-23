import { ScanScreen } from "@/components/scan/scan-screen";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * L'accueil = le Scanner : le geste central de l'app (specs §1). Caméra ZXing,
 * saisie du code au clavier, ou saisie manuelle complète — le scan ne peut pas
 * échouer.
 *
 * Groupe de route `(scan)` (fluidité #331, item 5) : il porte le `loading.tsx`
 * du Scanner SEUL — posé au niveau `(app)`, le squelette aurait aussi servi
 * les redirections /pal et /stats.
 *
 * Le compteur de la boîte de finition (#101 lot C) part en PROMESSE : la page
 * rend tout de suite, la caméra monte sans l'attendre, et la pastille se lit
 * en streaming sous Suspense (`PendingInboxLink`). Son échec n'emporte pas la
 * page — sans compteur le scan marche, et c'est le seul geste qui compte.
 */
export default function ScannerPage() {
  return <ScanScreen pendingInboxCount={loadPendingInboxCount()} />;
}

async function loadPendingInboxCount(): Promise<number> {
  const supabase = await createServerSupabaseClient();
  const { count, error } = await supabase
    .from("scan_inbox")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .is("deleted_at", null);

  if (error) console.error("[scan] compteur de finition:", error.message);
  return count ?? 0;
}
