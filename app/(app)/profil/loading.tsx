/**
 * Squelette du profil (#126, refondu au lot C §4.14) — affiché instantanément
 * au tap pendant le rendu serveur : titre, identité, la grille 2×2 de la
 * carte de paliste, puis les sections (personnaliser, cercle, réglages) —
 * la silhouette de l'espace personnel.
 */
export default function ProfilLoading() {
  return (
    <section className="py-6" role="status" aria-label="Chargement du profil">
      <span className="sr-only">Chargement…</span>
      <div aria-hidden className="animate-pulse">
        <div className="h-8 w-28 rounded bg-foreground/10" />
        <div className="mt-4 flex items-center gap-4">
          <div className="size-14 shrink-0 rounded-full bg-foreground/10" />
          <div className="min-w-0 flex-1">
            <div className="h-4 w-1/2 rounded bg-foreground/10" />
            <div className="mt-2 h-3 w-2/3 rounded bg-foreground/10" />
          </div>
        </div>
        {/* La carte de paliste — la carte héros (#234) : une carte haute. */}
        <div className="mt-4 h-64 rounded-card bg-foreground/10" />
        <div className="mt-6 rounded-xl border border-foreground/10 p-4">
          <div className="h-4 w-1/3 rounded bg-foreground/10" />
          <div className="mt-2 h-9 w-full rounded-xl bg-foreground/10" />
        </div>
        <div className="mt-3 h-11 w-full rounded-xl bg-foreground/10" />
      </div>
    </section>
  );
}
