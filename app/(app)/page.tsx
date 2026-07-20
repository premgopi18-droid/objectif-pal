import { ScanScreen } from "@/components/scan/scan-screen";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * L'accueil = le Scanner : le geste central de l'app (specs §1). Caméra ZXing,
 * saisie du code au clavier, ou saisie manuelle complète — le scan ne peut pas
 * échouer.
 *
 * Le compteur de la boîte de finition (#101 lot C) est chargé ICI, côté
 * serveur : la pastille doit être visible dès l'arrivée, sans requête client au
 * montage. Son échec n'emporte pas la page — sans compteur le scan marche, et
 * c'est le seul geste qui compte vraiment.
 */
export default async function ScannerPage() {
  const supabase = await createServerSupabaseClient();
  const { count, error } = await supabase
    .from("scan_inbox")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .is("deleted_at", null);

  if (error) console.error("[scan] compteur de finition:", error.message);

  return <ScanScreen pendingInboxCount={count ?? 0} />;
}
