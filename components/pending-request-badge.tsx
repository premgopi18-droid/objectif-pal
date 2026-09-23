import { unstable_rethrow } from "next/navigation";
import { getPendingRequestCount } from "@/lib/circle/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * La pastille des demandes d'ami (§4.14 : une demande se VOIT, elle n'est pas
 * poussée) — composant SERVEUR async, passé en slot à `BottomNavigation` sous
 * un `<Suspense fallback={null}>` (fluidité #331, item 4, review #337) : seule
 * la pastille streame, la barre d'onglets est peinte tout de suite et ne bouge
 * plus. UN SEUL appel réseau (suivi review #227, lot B) : la fonction SQL lit
 * l'identité dans le jeton, plus de `getUser()` dans le shell.
 *
 * Ne lève jamais : un échec vaut « pas de pastille », jamais un error boundary
 * pour 16 px d'interface.
 */
export async function PendingRequestBadge() {
  let count = 0;
  try {
    const supabase = await createServerSupabaseClient();
    count = await getPendingRequestCount(supabase);
  } catch (error) {
    // Les erreurs INTERNES de Next repartent (review #337) : l'exception sur
    // `cookies()` est le signal « route dynamique » du build, jamais à avaler.
    unstable_rethrow(error);
    console.error("[shell] pastille des demandes d'ami:", error);
  }
  if (count <= 0) return null;

  // Cyan sur liseré sombre pour se détacher de l'icône, plafonnée à 9+.
  return (
    <span
      aria-label={`${count} demande${count > 1 ? "s" : ""} d'ami en attente`}
      className="absolute -right-2 -top-1.5 grid min-w-4 place-items-center rounded-full border-2 border-bg0 bg-cyan px-0.5 text-[9px] font-black leading-4 text-bg0"
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
