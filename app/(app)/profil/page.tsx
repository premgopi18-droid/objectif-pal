import { DeleteAccountButton } from "@/components/delete-account-button";
import { InstallSection } from "@/components/install-section";
import { LogoutButton } from "@/components/logout-button";
import { ProfileEditor } from "@/components/profile/profile-editor";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Le profil : qui est connecté, les exports, la déconnexion, et l'attribution
 * des données — GCD et Metron sont en CC BY-SA 4.0, les créditer est une
 * OBLIGATION de licence (specs §6), pas une politesse : contenu et liens
 * intacts, seul le style change (design-specs §5 « Profil »).
 */

// Les exports sont des téléchargements → des ancres (`<a download>`), pas des
// <button> : impossible d'imbriquer le <button> du composant Button dans une
// ancre. On reprend donc l'allure du Button ghost via les tokens (§4), à
// l'identique de la variante `ghost` — cible tactile ≥ 44px (`min-h-11`).
const GHOST_LINK =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line " +
  "bg-card2 px-4 py-3 text-sm font-bold text-ink transition active:scale-[0.97] " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan";

const SECTION_LABEL = "text-xs font-extrabold uppercase tracking-[0.1em] text-ink3";

const CSV_TABLES = {
  books: "livres",
  readings: "lectures",
  reading_events: "événements",
  purchases: "achats",
} as const;

export default async function ProfilPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase.from("profiles").select("display_name, avatar_url").eq("id", user.id).single()
    : { data: null };

  const displayName = profile?.display_name ?? user?.email ?? "lecteur";
  const initial = displayName.charAt(0).toUpperCase();
  const avatarUrl = profile?.avatar_url ?? null;

  return (
    <section className="flex min-h-full flex-col gap-8 py-6">
      <h1 className="text-[22px] font-black uppercase italic tracking-tight">Profil</h1>

      {/* La photo de profil (#224) si posée — sinon l'avatar historique :
          initiale sur dégradé, encre `--bg0` (pas de blanc — audit #66, AA).
          URL maison versionnée (?v=) → <img> nue, comme les couvertures
          internes : next/image n'optimiserait rien de plus sur 56 px. */}
      <div className="flex items-center gap-4">
        {avatarUrl !== null ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="size-14 shrink-0 rounded-full object-cover" />
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
          {user?.email && <p className="truncate text-sm text-ink2">{user.email}</p>}
        </div>
      </div>

      {/* Personnalisation (#224) : pseudo + photo — la donnée que le cercle
          d'amis (§4.14) affichera telle quelle. */}
      <section className="flex flex-col gap-3">
        <h2 className={SECTION_LABEL}>Personnaliser</h2>
        <ProfileEditor displayName={displayName} hasAvatar={avatarUrl !== null} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={SECTION_LABEL}>Mes données</h2>
        <p className="text-sm text-ink2">
          Tout ce que l&apos;app sait — livres, lectures avec notes et avis, journal des changements d&apos;état,
          achats, y compris ce que tu as supprimé. Tes données sont à toi.
        </p>
        <a href="/api/export" download className={`${GHOST_LINK} w-full`}>
          Exporter tout (JSON)
        </a>
        <p className="text-xs text-ink3">Ou en CSV, table par table :</p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(CSV_TABLES) as (keyof typeof CSV_TABLES)[]).map((table) => (
            <a key={table} href={`/api/export?format=csv&table=${table}`} download className={GHOST_LINK}>
              {CSV_TABLES[table]}
            </a>
          ))}
        </div>
      </section>

      {/* « Application » (#89) : installation guidée de la PWA. Le composant
          client porte sa propre <section> (titre compris) pour disparaître
          entièrement une fois l'app installée. */}
      <InstallSection labelClassName={SECTION_LABEL} />

      <section className="flex flex-col gap-3">
        <h2 className={SECTION_LABEL}>Session</h2>
        <LogoutButton />
      </section>

      {/* RGPD (epic #182) : le droit à l'effacement, complet — données,
          photos, invitation. L'export est juste au-dessus : partir AVEC ses
          données reste le chemin naturel. */}
      <section className="flex flex-col gap-3">
        <h2 className={SECTION_LABEL}>Zone dangereuse</h2>
        <p className="text-sm text-ink2">
          Supprimer ton compte efface définitivement tout — livres, lectures, notes et avis, photos, historique,
          invitation. Aucun retour en arrière. Pense à exporter tes données d&apos;abord.
        </p>
        <DeleteAccountButton />
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
