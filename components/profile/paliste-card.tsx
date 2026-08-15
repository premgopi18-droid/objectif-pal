import { ALL_PICK_KINDS, PICK_KIND_MEDALS, type PickKind } from "@/lib/books/pick-kinds";
import type { PalisteCard as PalisteCardData } from "@/lib/profile/paliste-card";
import { formatMonthFrench } from "@/lib/dates";
import { formatPointsLabel } from "@/lib/scoring/report-text";

/**
 * La carte de paliste en CARTE HÉROS (#234, maquette A validée le 15/08/2026)
 * — l'identité de jeu, dérivée des seuls agrégats. UN composant pour DEUX
 * surfaces (mon Profil, la fiche d'un ami) : l'« aperçu honnête » est garanti
 * par construction. Purement présentatiel.
 *
 * La mise en scène est celle du score du Bilan (design-specs §5) : liseré
 * dégradé signature, total de l'année en héros (900 italique, clip-text), et
 * le palmarès dans la langue des distinctions — les médailles 🏆🎉💀 de
 * `PICK_KIND_MEDALS`, avec compte et libellé accordé. Un type à zéro ne
 * s'affiche pas ; aucune distinction → le bloc s'efface.
 */

/** Le libellé court d'un palmarès, accordé au compte — le libellé long (« L'œuvre préférée du mois ») reste au Bilan. */
const palmaresLabel = (kind: PickKind, count: number): string => {
  switch (kind) {
    case "favorite":
      return count > 1 ? "œuvres préférées" : "œuvre préférée";
    case "good_surprise":
      return count > 1 ? "bonnes surprises" : "bonne surprise";
    case "bad_surprise":
      return count > 1 ? "mauvaises surprises" : "mauvaise surprise";
  }
};

const CARD_LABEL = "text-[11px] font-bold uppercase tracking-[0.1em] text-ink3";

export function PalisteCard({ card }: { card: PalisteCardData }) {
  const { bestMonth } = card;
  const decoratedKinds = ALL_PICK_KINDS.filter((kind) => card.distinctionCounts[kind] > 0);

  if (bestMonth === null) {
    return (
      <p className="rounded-card border border-line bg-card px-4 py-3.5 text-sm text-ink2">
        La carte se remplit au premier mois clos — le bilan du mois en cours reste secret jusqu&apos;à
        l&apos;antenne.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-card border border-line bg-card">
      {/* Le liseré signature — la carte d'identité a droit au dégradé (§2). */}
      <div aria-hidden className="bg-grad h-1" />
      <div className="flex flex-col gap-3.5 p-4">
        <div className="flex items-baseline justify-between">
          <span className={CARD_LABEL}>Carte de paliste</span>
          <span className={`${CARD_LABEL} tabular-nums`}>{card.year}</span>
        </div>

        {/* Le héros : la même mise en scène que le score du Bilan. */}
        <div className="py-1 text-center">
          <div className="bg-grad bg-clip-text text-[42px] font-black italic leading-none text-transparent tabular-nums">
            {formatPointsLabel(card.yearTotal)}
          </div>
          <div className={`mt-2 ${CARD_LABEL}`}>Total de l&apos;année</div>
        </div>

        <div className="grid grid-cols-2">
          <div className="px-2 text-center">
            <div className={CARD_LABEL}>Meilleur mois</div>
            <div className="mt-1 text-[21px] font-black tabular-nums">{formatPointsLabel(bestMonth.total)}</div>
            <div className="mt-0.5 text-xs capitalize text-ink2">{formatMonthFrench(bestMonth.month)}</div>
          </div>
          <div className="border-l border-line px-2 text-center">
            <div className={CARD_LABEL}>Lectures</div>
            <div className="mt-1 text-[21px] font-black tabular-nums">{card.readingCount}</div>
            <div className="mt-0.5 text-xs text-ink2">mois clos</div>
          </div>
        </div>

        {decoratedKinds.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <span className={CARD_LABEL}>Palmarès</span>
            {decoratedKinds.map((kind) => (
              <div key={kind} className="flex items-center gap-2.5 text-sm">
                <span aria-hidden className="w-6 text-center text-lg">
                  {PICK_KIND_MEDALS[kind]}
                </span>
                <span className="w-5 text-base font-black tabular-nums">{card.distinctionCounts[kind]}</span>
                <span className="text-ink2">{palmaresLabel(kind, card.distinctionCounts[kind])}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
