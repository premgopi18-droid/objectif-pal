import Link from "next/link";
import { GuestCardForm } from "@/components/share/guest-card-form";

/**
 * La carte d'invité (§4.15) — l'outil d'antenne : générer une carte de bilan
 * pour un invité du live qui n'utilise pas l'app. Nom, photo, compteurs par
 * catégorie — le score sort du même barème, la carte du même moteur de rendu.
 * Rien ne touche la base : l'invité n'existe pas en base, et c'est voulu.
 */

export default function CarteInvitePage() {
  return (
    <section className="flex min-h-full flex-col gap-6 py-6">
      <div>
        <Link
          href="/profil/reglages"
          className="text-sm font-bold text-ink3 transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
        >
          ← Réglages
        </Link>
        <h1 className="mt-1 text-[22px] font-black uppercase italic tracking-tight">Carte d&apos;invité</h1>
        <p className="mt-2 text-sm text-ink2">
          La carte de bilan d&apos;un invité du live, sans compte : renseigne ses lectures, l&apos;app calcule
          son score au même barème et dessine la même carte. Rien n&apos;est enregistré.
        </p>
      </div>
      <GuestCardForm />
    </section>
  );
}
