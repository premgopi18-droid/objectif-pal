/**
 * Squelette des réglages (§4.14, lot C) — retour, titre, puis la silhouette
 * des blocs (données, application, session, zone dangereuse).
 */
export default function ReglagesLoading() {
  return (
    <section className="py-6" role="status" aria-label="Chargement des réglages">
      <span className="sr-only">Chargement…</span>
      <div aria-hidden className="animate-pulse">
        <div className="h-4 w-16 rounded bg-foreground/10" />
        <div className="mt-2 h-8 w-36 rounded bg-foreground/10" />
        <div className="mt-6 h-4 w-1/3 rounded bg-foreground/10" />
        <div className="mt-2 h-11 w-full rounded-xl bg-foreground/10" />
        <div className="mt-6 h-4 w-1/3 rounded bg-foreground/10" />
        <div className="mt-2 h-11 w-full rounded-xl bg-foreground/10" />
        <div className="mt-6 h-4 w-1/3 rounded bg-foreground/10" />
        <div className="mt-2 h-11 w-full rounded-xl bg-foreground/10" />
      </div>
    </section>
  );
}
