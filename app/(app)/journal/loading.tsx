/**
 * Squelette du journal — affiché instantanément au tap d'onglet pendant le
 * rendu serveur (la page est dynamique) : titre, filtres d'état, puis des
 * vignettes 48×72 avec deux lignes de texte, la silhouette de JournalList.
 */
export default function JournalLoading() {
  return (
    <section className="py-6" role="status" aria-label="Chargement du journal">
      <span className="sr-only">Chargement…</span>
      <div aria-hidden className="animate-pulse">
        <div className="h-8 w-32 rounded bg-foreground/10" />
        {/* Tailwind ne génère que les classes écrites en clair : pas d'interpolation. */}
        <div className="mt-4 flex flex-wrap gap-2">
          <div className="h-8 w-16 rounded-full bg-foreground/10" />
          <div className="h-8 w-20 rounded-full bg-foreground/10" />
          <div className="h-8 w-24 rounded-full bg-foreground/10" />
          <div className="h-8 w-28 rounded-full bg-foreground/10" />
        </div>
        <div className="mt-4 flex flex-col gap-3">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex gap-3 rounded-xl border border-foreground/10 p-3">
              <div className="h-18 w-12 shrink-0 rounded bg-foreground/10" />
              <div className="min-w-0 flex-1">
                <div className="h-4 w-2/3 rounded bg-foreground/10" />
                <div className="mt-2 h-3 w-1/2 rounded bg-foreground/10" />
                <div className="mt-2 h-3 w-1/3 rounded bg-foreground/10" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
