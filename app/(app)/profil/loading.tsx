/**
 * Squelette du profil (#126) — affiché instantanément au tap pendant le rendu
 * serveur : titre, bloc identité, puis les blocs d'actions (export, crédits,
 * déconnexion), la silhouette de la page.
 */
export default function ProfilLoading() {
  return (
    <section className="py-6" role="status" aria-label="Chargement du profil">
      <span className="sr-only">Chargement…</span>
      <div aria-hidden className="animate-pulse">
        <div className="h-8 w-28 rounded bg-foreground/10" />
        <div className="mt-4 rounded-xl border border-foreground/10 p-4">
          <div className="h-4 w-1/2 rounded bg-foreground/10" />
          <div className="mt-2 h-3 w-2/3 rounded bg-foreground/10" />
        </div>
        <div className="mt-3 rounded-xl border border-foreground/10 p-4">
          <div className="h-4 w-1/3 rounded bg-foreground/10" />
          <div className="mt-2 h-9 w-full rounded-xl bg-foreground/10" />
        </div>
        <div className="mt-3 h-11 w-full rounded-xl bg-foreground/10" />
      </div>
    </section>
  );
}
