import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleMonthsList } from "@/components/circle/circle-months-list";
import { PageLoadError } from "@/components/page-load-error";
import { getCircleReportsView } from "@/lib/circle/report-queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * La fiche d'un ami (§4.14, lot B) : pseudo + photo + ses mois clos, du plus
 * récent au plus ancien — le contenu exact des lignes d'agrégat servies par
 * l'amitié, rien d'autre. Un id qui n'est pas un ami accepté → 404 : la
 * fonction `security definer` ne sert que les amis, la fiche ne peut donc
 * rien montrer d'autre (défense en profondeur, pas seulement de l'UI).
 * Le corps (carte de paliste + mois servis) est le composant PARTAGÉ avec le
 * mode spectateur (#252) — même rendu, même vérité.
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

      <CircleMonthsList participant={friend} />
    </section>
  );
}
