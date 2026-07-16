/**
 * Squelette du bilan — affiché instantanément au tap d'onglet pendant le
 * rendu serveur (la page est dynamique) : titre, navigation de mois, la carte
 * du décompte (lignes + score), et le bouton copier, la silhouette de
 * MonthlyReportView.
 */
export default function BilanLoading() {
  return (
    <section className="py-6" role="status" aria-label="Chargement du bilan">
      <span className="sr-only">Chargement…</span>
      <div aria-hidden className="animate-pulse">
        <div className="h-8 w-40 rounded bg-foreground/10" />
        <div className="mt-4 flex items-center justify-between">
          <div className="size-9 rounded-full border border-foreground/10 bg-foreground/10" />
          <div className="h-6 w-32 rounded bg-foreground/10" />
          <div className="size-9 rounded-full border border-foreground/10 bg-foreground/10" />
        </div>
        <div className="mt-5 rounded-xl border border-foreground/10">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-baseline justify-between border-b border-foreground/10 px-4 py-3">
              <div className="h-4 w-32 rounded bg-foreground/10" />
              <div className="h-4 w-10 rounded bg-foreground/10" />
            </div>
          ))}
          <div className="flex items-center justify-between px-4 py-4">
            <div className="h-6 w-36 rounded bg-foreground/10" />
            <div className="h-8 w-14 rounded bg-foreground/10" />
          </div>
        </div>
        <div className="mt-5 h-12 rounded-full border-2 border-foreground/10" />
      </div>
    </section>
  );
}
