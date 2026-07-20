/**
 * Squelette de la boîte de finition (#126) — affiché instantanément au tap
 * pendant le rendu serveur, comme journal/bilan/bibliothèque : titre puis des
 * cartes avec vignette et boutons, la silhouette de FinitionView.
 */
export default function FinitionLoading() {
  return (
    <section className="py-6" role="status" aria-label="Chargement de la boîte de finition">
      <span className="sr-only">Chargement…</span>
      <div aria-hidden className="animate-pulse">
        <div className="h-8 w-40 rounded bg-foreground/10" />
        <div className="mt-2 h-4 w-3/4 rounded bg-foreground/10" />
        <div className="mt-4 flex flex-col gap-3">
          {[0, 1, 2].map((row) => (
            <div key={row} className="rounded-xl border border-foreground/10 p-3">
              <div className="flex gap-3">
                <div className="h-18 w-12 shrink-0 rounded bg-foreground/10" />
                <div className="min-w-0 flex-1">
                  <div className="h-4 w-2/3 rounded bg-foreground/10" />
                  <div className="mt-2 h-3 w-1/2 rounded bg-foreground/10" />
                </div>
              </div>
              <div className="mt-3 h-9 w-28 rounded-xl bg-foreground/10" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
