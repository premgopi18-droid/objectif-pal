import Image from "next/image";
import Link from "next/link";
import { CircleMonthsList } from "@/components/circle/circle-months-list";
import { PageLoadError } from "@/components/page-load-error";
import { getCircleReportsView } from "@/lib/circle/report-queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Le mode spectateur (#252) : MON profil avec les yeux de mon cercle.
 *
 * Rien n'est simulé : la page rend `meAsCircleSees` — mes lignes telles que
 * les RPC `security definer` les servent à mes amis, verrou du reveal (#243)
 * compris. Mon dernier mois clos non révélé s'affiche donc 🔒, exactement
 * comme chez eux, et la carte de paliste l'exclut, exactement comme chez eux.
 * Complète le bouton « Révéler au cercle » du Bilan : on ne révèle plus à
 * l'aveugle, on vérifie.
 */
export default async function SpectatorPage() {
  const supabase = await createServerSupabaseClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (!userId) {
    return <PageLoadError title="Vu par mon cercle" message="Session introuvable — reconnecte-toi." />;
  }

  const view = await getCircleReportsView(supabase, userId);
  const me = view.meAsCircleSees;

  return (
    <section className="flex flex-col gap-5 py-6">
      <div>
        <Link
          href="/profil"
          className="text-sm font-bold text-ink3 transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
        >
          ← Profil
        </Link>
        <div className="mt-2 flex items-center gap-3">
          {me.avatarUrl !== null ? (
            <Image
              src={me.avatarUrl}
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
              {me.displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <h1 className="min-w-0 truncate text-[22px] font-black uppercase italic tracking-tight">{me.displayName}</h1>
        </div>
      </div>

      <p className="rounded-xl border border-line bg-card2 px-4 py-3 text-sm text-ink2">
        👀 Tu regardes ton profil <strong>avec les yeux de ton cercle</strong> — exactement ce que le serveur
        sert à tes amis, verrou du reveal compris. Rien de plus, rien de moins.
      </p>

      {!view.joined ? (
        <p className="text-sm text-ink2">
          Tu n&apos;as pas encore rejoint le cercle — personne ne voit ton profil pour l&apos;instant. La porte
          est sur ton <Link href="/profil" className="font-bold text-cyan underline">Profil</Link>.
        </p>
      ) : (
        <CircleMonthsList participant={me} spectator />
      )}
    </section>
  );
}
