/**
 * Squelette du Scanner (fluidité #331, item 5) — affiché instantanément au tap
 * du FAB pendant le rendu serveur. C'était le SEUL onglet sans squelette, sur
 * le geste où l'utilisateur est le plus pressé (le livre est dans sa main).
 * Il épouse ScanScreen : titre + sous-titre, le viseur (même ratio 3/3.4),
 * la pill du code au clavier, le bouton rafale.
 */
export default function ScannerLoading() {
  return (
    <section className="flex flex-col gap-4" role="status" aria-label="Chargement du scanner">
      <span className="sr-only">Chargement…</span>
      <div aria-hidden className="flex animate-pulse flex-col gap-4">
        <div>
          <div className="h-8 w-56 rounded bg-foreground/10" />
          <div className="mt-2 h-4 w-40 rounded bg-foreground/10" />
        </div>
        <div className="aspect-[3/3.4] rounded-card border border-line bg-bg0" />
        <div className="h-11 rounded-2xl border border-line bg-card" />
        <div className="h-11 rounded-xl bg-foreground/10" />
      </div>
    </section>
  );
}
