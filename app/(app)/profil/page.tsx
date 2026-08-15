import Image from "next/image";
import Link from "next/link";
import { CircleSection } from "@/components/circle/circle-section";
import { PalisteCard } from "@/components/profile/paliste-card";
import { ProfileEditor } from "@/components/profile/profile-editor";
import { getCircleView, type CircleView } from "@/lib/circle/queries";
import { parseStoredMonthlyReport } from "@/lib/circle/stored-report";
import { derivePalisteCard } from "@/lib/profile/paliste-card";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Le Profil — l'ESPACE PERSONNEL (§4.14, lot C) : le moi public (photo,
 * pseudo, carte de paliste — exactement ce que le cercle voit), le cercle,
 * la personnalisation, et une entrée vers les réglages (`/profil/reglages` —
 * exports, application, session, zone dangereuse y sont descendus).
 *
 * L'attribution GCD/Metron reste AU PIED DE CETTE PAGE : obligation de
 * licence CC BY-SA 4.0 (specs §6), pas un réglage — elle ne descend pas.
 *
 * La carte se dérive des SEULS agrégats (`monthly_reports` + `monthly_picks`)
 * — aucun fait brut chargé ici, zéro recalcul du moteur (§4.14). `getClaims` :
 * l'identité sans aller-retour réseau (#125).
 */

const SECTION_LABEL = "text-xs font-extrabold uppercase tracking-[0.1em] text-ink3";

export default async function ProfilPage() {
  const supabase = await createServerSupabaseClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  const email = typeof claims?.claims.email === "string" ? claims.claims.email : null;

  const emptyCircle: CircleView = { joined: false, friends: [], received: [], sent: [] };
  const [{ data: profile }, circle, { data: reportRows }, { data: pickRows }] = userId
    ? await Promise.all([
        supabase.from("profiles").select("display_name, avatar_url").eq("id", userId).single(),
        getCircleView(supabase, userId),
        supabase.from("monthly_reports").select("month, report"),
        supabase.from("monthly_picks").select("month, kind"),
      ])
    : [{ data: null }, emptyCircle, { data: null }, { data: null }];

  const displayName = profile?.display_name ?? email ?? "lecteur";
  const initial = displayName.charAt(0).toUpperCase();
  const avatarUrl = profile?.avatar_url ?? null;

  // La carte : les lignes illisibles s'écartent (parseur défensif du lot B),
  // le mois courant est celui du serveur (UTC — la convention de la synchro).
  const storedReports = (reportRows ?? [])
    .map((row) => parseStoredMonthlyReport(row.report))
    .filter((parsed) => parsed !== null);
  const picks = (pickRows ?? []).map((row) => ({ month: row.month.slice(0, 7), kind: row.kind }));
  const card = derivePalisteCard(storedReports, picks, new Date().toISOString().slice(0, 7));

  return (
    <section className="flex min-h-full flex-col gap-8 py-6">
      <h1 className="text-[22px] font-black uppercase italic tracking-tight">Profil</h1>

      {/* Le moi public : la photo (#224) si posée — sinon l'initiale sur
          dégradé, encre `--bg0` (audit #66, AA) — et la carte de paliste,
          l'aperçu honnête : c'est EXACTEMENT ce que le cercle voit. */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          {avatarUrl !== null ? (
            <Image
              src={avatarUrl}
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
              {initial}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate font-extrabold">{displayName}</p>
            {email !== null && <p className="truncate text-sm text-ink2">{email}</p>}
          </div>
        </div>
        <PalisteCard card={card} />
      </div>

      {/* Personnalisation (#224) : pseudo + photo — la donnée que le cercle
          d'amis (§4.14) affiche telle quelle. */}
      <section className="flex flex-col gap-3">
        <h2 className={SECTION_LABEL}>Personnaliser</h2>
        <ProfileEditor displayName={displayName} hasAvatar={avatarUrl !== null} />
      </section>

      {/* Le cercle (§4.14) : porte d'entrée, recherche, demandes, amis, et
          l'accès aux bilans comparés (/profil/cercle, lot B). */}
      <section className="flex flex-col gap-3">
        <h2 className={SECTION_LABEL}>Le cercle</h2>
        <CircleSection
          joined={circle.joined}
          currentDisplayName={displayName}
          friends={circle.friends}
          received={circle.received}
          sent={circle.sent}
        />
      </section>

      {/* Le moi privé, replié (lot C) : tout ce qui se touche deux fois par
          an vit en sous-page — la page respire. */}
      <section className="flex flex-col gap-3">
        <h2 className={SECTION_LABEL}>Réglages</h2>
        <Link
          href="/profil/reglages"
          className="inline-flex min-h-11 w-full items-center justify-between rounded-xl border border-line bg-card2 px-4 py-3 text-sm font-bold text-ink transition active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
        >
          Mes données, application, session…
          <span aria-hidden className="text-ink3">
            →
          </span>
        </Link>
      </section>

      <footer className="mt-auto border-t border-line pt-4 text-xs leading-relaxed text-ink3">
        <p>
          Données bibliographiques :{" "}
          <a href="https://www.comics.org" className="text-ink2 underline" rel="noopener noreferrer" target="_blank">
            Grand Comics Database™ (GCD)
          </a>{" "}
          et{" "}
          <a href="https://metron.cloud" className="text-ink2 underline" rel="noopener noreferrer" target="_blank">
            Metron
          </a>
          , sous licence{" "}
          <a
            href="https://creativecommons.org/licenses/by-sa/4.0/deed.fr"
            className="text-ink2 underline"
            rel="noopener noreferrer"
            target="_blank"
          >
            CC BY-SA 4.0
          </a>
          . Identification des ouvrages français et couvertures (récupérées le jour du scan) :{" "}
          <a href="https://api.bnf.fr" className="text-ink2 underline" rel="noopener noreferrer" target="_blank">
            catalogue général de la BnF
          </a>
          .
        </p>
      </footer>
    </section>
  );
}
