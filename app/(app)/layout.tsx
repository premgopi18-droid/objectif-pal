import { BottomNavigation } from "@/components/bottom-navigation";
import { InstallBanner } from "@/components/install-banner";
import { getPendingRequestCount } from "@/lib/circle/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Le shell des écrans connectés : contenu + barre d'onglets. Le proxy garantit
 * qu'on n'arrive ici qu'avec une session — pas de re-vérification par page.
 *
 * La pastille du Profil (§4.14 : une demande d'ami se VOIT, elle n'est pas
 * poussée) se charge ici, avec la nav — une requête `count` head, rafraîchie
 * au chargement et aux revalidations, jamais bloquante pour le rendu.
 */
export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const pendingRequestCount = user ? await getPendingRequestCount(supabase, user.id) : 0;

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      {/* Bannière d'installation (#89) : en haut (le bas est pris par la tab
          bar + FAB), et ici — pas dans le layout racine — pour épargner /login. */}
      <InstallBanner />
      {/* pb-24 : l'espace de la barre d'onglets fixe. */}
      <main className="flex-1 px-4 pb-24 pt-6">{children}</main>
      <BottomNavigation pendingRequestCount={pendingRequestCount} />
    </div>
  );
}
