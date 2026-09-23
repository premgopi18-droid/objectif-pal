import { Suspense } from "react";
import { BottomNavigation } from "@/components/bottom-navigation";
import { InstallBanner } from "@/components/install-banner";
import { getPendingRequestCount } from "@/lib/circle/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Le shell des écrans connectés : contenu + barre d'onglets. Le proxy garantit
 * qu'on n'arrive ici qu'avec une session — pas de re-vérification par page.
 *
 * La pastille du Profil (§4.14 : une demande d'ami se VOIT, elle n'est pas
 * poussée) se charge ici, avec la nav — UN SEUL appel réseau (suivi review
 * #227, lot B) : la fonction SQL lit l'identité dans le jeton, plus de
 * `getUser()` dans le shell.
 *
 * Fluidité #331 (item 4) : ce layout n'attend RIEN. Avant, il `await`ait la
 * RPC de la pastille avant de laisser `children` commencer à rendre — un
 * aller-retour Supabase en série devant la première requête de CHAQUE page
 * (visible en entier sur /profil/reglages, qui n'a aucune requête propre). La
 * nav se rend tout de suite sans pastille ; la variante comptée la remplace
 * quand la RPC répond (Suspense, streaming), jamais bloquante pour le rendu.
 */
export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      {/* Bannière d'installation (#89) : en haut (le bas est pris par la tab
          bar + FAB), et ici — pas dans le layout racine — pour épargner /login. */}
      <InstallBanner />
      {/* pb-24 : l'espace de la barre d'onglets fixe. */}
      <main className="flex-1 px-4 pb-24 pt-6">{children}</main>
      <Suspense fallback={<BottomNavigation />}>
        <BottomNavigationWithBadge />
      </Suspense>
    </div>
  );
}

/** La nav avec sa pastille — le seul morceau du shell qui attend le réseau. */
async function BottomNavigationWithBadge() {
  const supabase = await createServerSupabaseClient();
  const pendingRequestCount = await getPendingRequestCount(supabase);
  return <BottomNavigation pendingRequestCount={pendingRequestCount} />;
}
