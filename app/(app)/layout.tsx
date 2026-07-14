import { BottomNavigation } from "@/components/bottom-navigation";

/**
 * Le shell des écrans connectés : contenu + barre d'onglets. Le proxy garantit
 * qu'on n'arrive ici qu'avec une session — pas de re-vérification par page.
 */
export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      {/* pb-24 : l'espace de la barre d'onglets fixe. */}
      <main className="flex-1 px-4 pb-24 pt-6">{children}</main>
      <BottomNavigation />
    </div>
  );
}
