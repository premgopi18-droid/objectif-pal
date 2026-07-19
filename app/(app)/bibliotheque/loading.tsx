/**
 * Squelette de la Bibliothèque — affiché instantanément au tap d'onglet pendant
 * le rendu serveur (la page est dynamique). Il épouse le volet par défaut (Pile,
 * §3) : titre, les deux cartes de santé du mois, puis des vignettes 48×72 avec
 * le bouton « Je le commence », la silhouette de PalView.
 */
export default function BibliothequeLoading() {
  return (
    <section className="py-6" role="status" aria-label="Chargement de la pile">
      <span className="sr-only">Chargement…</span>
      <div aria-hidden className="animate-pulse">
        <div className="h-8 w-28 rounded bg-foreground/10" />
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-foreground/10 p-3">
            <div className="h-3 w-16 rounded bg-foreground/10" />
            <div className="mt-2 h-7 w-10 rounded bg-foreground/10" />
          </div>
          <div className="rounded-xl border border-foreground/10 p-3">
            <div className="h-3 w-20 rounded bg-foreground/10" />
            <div className="mt-2 h-7 w-16 rounded bg-foreground/10" />
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-3">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex items-center gap-3 rounded-xl border border-foreground/10 p-3">
              <div className="h-18 w-12 shrink-0 rounded bg-foreground/10" />
              <div className="min-w-0 flex-1">
                <div className="h-4 w-2/3 rounded bg-foreground/10" />
                <div className="mt-2 h-3 w-1/2 rounded bg-foreground/10" />
                <div className="mt-2 h-3 w-1/3 rounded bg-foreground/10" />
              </div>
              <div className="h-9 w-28 shrink-0 rounded-full bg-foreground/10" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
