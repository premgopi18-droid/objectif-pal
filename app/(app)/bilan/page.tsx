/**
 * Le bilan mensuel au barème (specs §4.5) — LE livrable de l'app : l'écran
 * qu'on lit à l'antenne. Le moteur existe (lib/scoring/), l'écran le branchera
 * dès qu'il y aura des lectures à compter.
 */
export default function BilanPage() {
  return (
    <section className="py-6">
      <h1 className="text-2xl font-bold">Bilan du mois</h1>
      <p className="mt-3 text-sm opacity-70">
        Le décompte par catégorie, les achats non lus et le score du mois — prêt à être lu à l&apos;antenne.
      </p>
    </section>
  );
}
