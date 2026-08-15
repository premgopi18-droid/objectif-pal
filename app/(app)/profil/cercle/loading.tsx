/**
 * Squelette des bilans du cercle (§4.14, lot B) — la silhouette de la page :
 * retour, titre, navigation de mois, puis les lignes du classement.
 */
export default function CircleReportsLoading() {
  return (
    <section className="py-6" role="status" aria-label="Chargement des bilans du cercle">
      <span className="sr-only">Chargement…</span>
      <div aria-hidden className="animate-pulse">
        <div className="h-4 w-16 rounded bg-foreground/10" />
        <div className="mt-2 h-8 w-48 rounded bg-foreground/10" />
        <div className="mt-5 flex items-center justify-between">
          <div className="size-11 rounded-xl bg-foreground/10" />
          <div className="h-5 w-28 rounded bg-foreground/10" />
          <div className="size-11 rounded-xl bg-foreground/10" />
        </div>
        <div className="mt-3 h-14 w-full rounded-card bg-foreground/10" />
        <div className="mt-2 h-14 w-full rounded-card bg-foreground/10" />
        <div className="mt-2 h-14 w-full rounded-card bg-foreground/10" />
      </div>
    </section>
  );
}
