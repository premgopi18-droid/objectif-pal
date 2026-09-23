import { Suspense } from "react";
import { BottomNavigation } from "@/components/bottom-navigation";
import { InstallBanner } from "@/components/install-banner";
import { PendingRequestBadge } from "@/components/pending-request-badge";

/**
 * Le shell des écrans connectés : contenu + barre d'onglets. Le proxy garantit
 * qu'on n'arrive ici qu'avec une session — pas de re-vérification par page.
 *
 * Fluidité #331 (item 4) : ce layout n'attend RIEN. Avant, il `await`ait la
 * RPC de la pastille Profil avant de laisser `children` commencer à rendre —
 * un aller-retour Supabase en série devant la première requête de CHAQUE page
 * (visible en entier sur /profil/reglages, qui n'a aucune requête propre). La
 * barre est peinte tout de suite ; seule la pastille (`PendingRequestBadge`,
 * composant serveur passé en slot sous Suspense — review #337) streame quand
 * la RPC répond. Jamais bloquante pour le rendu.
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
      <BottomNavigation
        profileBadge={
          <Suspense fallback={null}>
            <PendingRequestBadge />
          </Suspense>
        }
      />
    </div>
  );
}
