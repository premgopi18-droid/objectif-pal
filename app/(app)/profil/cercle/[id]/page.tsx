import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MonthReportCard } from "@/components/circle/month-report-card";
import { PageLoadError } from "@/components/page-load-error";
import { PalisteCard } from "@/components/profile/paliste-card";
import { Card } from "@/components/ui/card";
import { getCircleReportsView } from "@/lib/circle/report-queries";
import { formatMonthFrench } from "@/lib/dates";
import { derivePalisteCard } from "@/lib/profile/paliste-card";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * La fiche d'un ami (§4.14, lot B) : pseudo + photo + ses mois clos, du plus
 * récent au plus ancien — le contenu exact des lignes d'agrégat servies par
 * l'amitié, rien d'autre. Un id qui n'est pas un ami accepté → 404 : la
 * fonction `security definer` ne sert que les amis, la fiche ne peut donc
 * rien montrer d'autre (défense en profondeur, pas seulement de l'UI).
 * En tête : la carte de paliste (lot C, #230) — le MÊME composant que sur mon
 * Profil, dérivé des mêmes agrégats : l'« aperçu honnête » par construction.
 */
export default async function FriendPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (!userId) {
    return <PageLoadError title="Fiche ami" message="Session introuvable — reconnecte-toi." />;
  }

  const view = await getCircleReportsView(supabase, userId);
  const friend = view.participants.find((participant) => participant.id === id && !participant.isMe);
  if (!view.joined || friend === undefined) notFound();

  const months = [
    ...new Set([...Object.keys(friend.reportsByMonth), ...friend.unreadableMonths]),
  ]
    .sort()
    .reverse();

  // La carte de paliste de l'ami — les picks servis sont déjà « mois clos
  // seulement » (RPC lot B), le mois courant est celui du serveur (UTC).
  const card = derivePalisteCard(
    Object.values(friend.reportsByMonth),
    Object.entries(friend.picksByMonth).flatMap(([month, picks]) => picks.map((pick) => ({ month, kind: pick.kind }))),
    new Date().toISOString().slice(0, 7),
  );

  return (
    <section className="flex flex-col gap-5 py-6">
      <div>
        <Link
          href="/profil/cercle"
          className="text-sm font-bold text-ink3 transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
        >
          ← Bilans du cercle
        </Link>
        <div className="mt-2 flex items-center gap-3">
          {friend.avatarUrl !== null ? (
            <Image
              src={friend.avatarUrl}
              alt=""
              width={56}
              height={56}
              unoptimized
              className="size-14 shrink-0 rounded-full object-cover"
            />
          ) : (
            <div
              aria-hidden
              className="grid size-14 shrink-0 place-items-center rounded-full bg-grad text-[22px] font-black text-bg0"
            >
              {friend.displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <h1 className="min-w-0 truncate text-[22px] font-black uppercase italic tracking-tight">
            {friend.displayName}
          </h1>
        </div>
      </div>

      {months.length === 0 ? (
        <p className="text-sm text-ink2">
          Rien encore — les bilans apparaissent au premier mois clos. Le mois en cours reste secret jusqu&apos;au
          bilan.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <PalisteCard card={card} />
          {months.map((month) => {
            const stored = friend.reportsByMonth[month];
            return (
              <div key={month}>
                <h2 className="mb-2 text-sm font-extrabold capitalize text-ink2">{formatMonthFrench(month)}</h2>
                <Card>
                  {stored !== undefined ? (
                    <MonthReportCard
                      stored={stored}
                      picks={friend.picksByMonth[month] ?? []}
                      ownerDisplayName={friend.displayName}
                    />
                  ) : (
                    <p className="text-sm text-ink3">Bilan indisponible pour ce mois.</p>
                  )}
                </Card>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
