/** Le journal des lectures (specs §4.2) — l'écran arrive avec le scan. */
export default function JournalPage() {
  return (
    <section className="py-6">
      <h1 className="text-2xl font-bold">Journal</h1>
      <p className="mt-3 text-sm opacity-70">
        Tes lectures — en cours, terminées, abandonnées — apparaîtront ici dès le premier scan.
      </p>
    </section>
  );
}
