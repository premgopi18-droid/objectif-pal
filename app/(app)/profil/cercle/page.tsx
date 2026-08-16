import Link from "next/link";
import { CircleReportsView } from "@/components/circle/circle-reports-view";
import { PageLoadError } from "@/components/page-load-error";
import { getCircleReportsView } from "@/lib/circle/report-queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Les bilans comparés du cercle (§4.14, lot B) — moi + mes amis, mois clos
 * par mois clos, plus le cumul de l'année. Sous le Profil : le cercle vit là
 * (décision du tour de spec). `getClaims` : l'identité sans aller-retour
 * réseau (#125). L'« année » et le « mois clos » suivent la convention UTC de
 * la synchro des agrégats (#214) — frontière de mois assumée, sans enjeu.
 */
export default async function CircleReportsPage() {
  const supabase = await createServerSupabaseClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (!userId) {
    return <PageLoadError title="Bilans du cercle" message="Session introuvable — reconnecte-toi." />;
  }

  const view = await getCircleReportsView(supabase, userId);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const currentYear = currentMonth.slice(0, 4);

  return (
    <section className="flex flex-col gap-5 py-6">
      <div>
        <Link
          href="/profil"
          className="text-sm font-bold text-ink3 transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
        >
          ← Profil
        </Link>
        <h1 className="mt-1 text-[22px] font-black uppercase italic tracking-tight">Bilans du cercle</h1>
      </div>

      {!view.joined ? (
        <p className="text-sm text-ink2">
          Entre d&apos;abord au cercle depuis ton <Link href="/profil" className="font-bold text-cyan underline">Profil</Link> —
          les bilans comparés s&apos;ouvrent avec lui.
        </p>
      ) : view.participants.length <= 1 ? (
        <p className="text-sm text-ink2">
          Personne à comparer pour l&apos;instant — ajoute des amis depuis ton{" "}
          <Link href="/profil" className="font-bold text-cyan underline">Profil</Link> : dès la première amitié,
          vos mois clos s&apos;affichent côte à côte.
        </p>
      ) : (
        <CircleReportsView
          participants={view.participants}
          currentYear={currentYear}
          currentMonth={currentMonth}
          myManualReveals={view.myManualReveals}
        />
      )}
    </section>
  );
}
