/**
 * Squelette des stats — affiché instantanément au tap d'onglet pendant le
 * rendu serveur : titre, puis la silhouette des quatre sections (santé PAL
 * avec sa courbe, volume, répartition, goûts).
 */
export default function StatsLoading() {
  return (
    <section className="py-6" role="status" aria-label="Chargement des statistiques">
      <span className="sr-only">Chargement…</span>
      <div aria-hidden className="animate-pulse">
        <div className="h-8 w-24 rounded bg-foreground/10" />
        {[0, 1, 2, 3].map((sectionIndex) => (
          <div key={sectionIndex} className="mt-5">
            <div className="h-5 w-36 rounded bg-foreground/10" />
            <div className="mt-2 rounded-xl border border-foreground/10 p-4">
              {sectionIndex === 0 ? (
                <div className="h-32 rounded bg-foreground/10" />
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="h-4 w-3/4 rounded bg-foreground/10" />
                  <div className="h-4 w-1/2 rounded bg-foreground/10" />
                  <div className="h-4 w-2/3 rounded bg-foreground/10" />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
