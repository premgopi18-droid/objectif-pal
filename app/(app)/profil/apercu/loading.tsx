/**
 * Squelette du mode spectateur (#252) — la silhouette de la page : retour,
 * identité, bandeau d'explication, puis les cartes de mois.
 */
export default function SpectatorLoading() {
  return (
    <section className="py-6" role="status" aria-label="Chargement du profil vu par le cercle">
      <span className="sr-only">Chargement…</span>
      <div aria-hidden className="animate-pulse">
        <div className="h-4 w-16 rounded bg-foreground/10" />
        <div className="mt-2 flex items-center gap-3">
          <div className="size-14 rounded-full bg-foreground/10" />
          <div className="h-7 w-40 rounded bg-foreground/10" />
        </div>
        <div className="mt-5 h-16 w-full rounded-xl bg-foreground/10" />
        <div className="mt-4 h-40 w-full rounded-card bg-foreground/10" />
        <div className="mt-4 h-56 w-full rounded-card bg-foreground/10" />
      </div>
    </section>
  );
}
