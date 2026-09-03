import Link from "next/link";
import { DeleteAccountButton } from "@/components/delete-account-button";
import { InstallSection } from "@/components/install-section";
import { LogoutButton } from "@/components/logout-button";

/**
 * Les réglages (§4.14, lot C) — le « moi privé » descendu du Profil : les
 * exports (§4.10), l'installation de l'app, la session et la zone dangereuse.
 * Les mécaniques sont DÉPLACÉES telles quelles — ce lot ne les réécrit pas.
 * L'attribution GCD/Metron, elle, reste au pied de `/profil` (licence, §6).
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

export default function ReglagesPage() {
  return (
    <section className="flex min-h-full flex-col gap-8 py-6">
      <div>
        <Link
          href="/profil"
          className="text-sm font-bold text-ink3 transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
        >
          ← Profil
        </Link>
        <h1 className="mt-1 text-[22px] font-black uppercase italic tracking-tight">Réglages</h1>
      </div>

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

      {/* L'outil d'antenne (§4.15) : la carte de bilan d'un invité du live,
          sans compte — le formulaire calcule au même barème et dessine la
          même carte. Rangé ici : c'est un outil de production, pas un réglage
          du compte, mais c'est bien le « moi privé » qui s'en sert. */}
      <section className="flex flex-col gap-3">
        <h2 className={SECTION_LABEL}>Antenne</h2>
        <p className="text-sm text-ink2">
          Générer la carte de bilan d&apos;un invité du live qui n&apos;utilise pas l&apos;app — même barème,
          mêmes thèmes, rien n&apos;est enregistré.
        </p>
        <Link href="/profil/carte-invite" className={`${GHOST_LINK} w-full`}>
          Carte d&apos;invité
        </Link>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={SECTION_LABEL}>Session</h2>
        <LogoutButton />
      </section>

      {/* RGPD (epic #182) : le droit à l'effacement, complet — données,
          photos, invitation, liens du cercle. L'export est juste au-dessus :
          partir AVEC ses données reste le chemin naturel. */}
      <section className="flex flex-col gap-3">
        <h2 className={SECTION_LABEL}>Zone dangereuse</h2>
        <p className="text-sm text-ink2">
          Supprimer ton compte efface définitivement tout — livres, lectures, notes et avis, photos, historique,
          invitation. Aucun retour en arrière. Pense à exporter tes données d&apos;abord.
        </p>
        <DeleteAccountButton />
      </section>
    </section>
  );
}
