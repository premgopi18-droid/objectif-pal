import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/ui/stat-tile";
import { ALL_PICK_KINDS, PICK_KIND_BADGE_STATE, PICK_KIND_LABELS } from "@/lib/books/pick-kinds";
import type { PalisteCard as PalisteCardData } from "@/lib/profile/paliste-card";
import { formatMonthFrench } from "@/lib/dates";
import { formatPointsLabel } from "@/lib/scoring/report-text";

/**
 * La carte de paliste (§4.14, lot C) — l'identité de jeu, dérivée des seuls
 * agrégats. UN composant pour DEUX surfaces (mon Profil, la fiche d'un ami) :
 * l'« aperçu honnête » est garanti par construction — ce que j'affiche est
 * exactement ce que mes amis voient. Purement présentatiel.
 */

export function PalisteCard({ card }: { card: PalisteCardData }) {
  const { bestMonth } = card;
  const totalDistinctions = ALL_PICK_KINDS.reduce((sum, kind) => sum + card.distinctionCounts[kind], 0);

  if (bestMonth === null) {
    return (
      <p className="rounded-card border border-line bg-card px-4 py-3.5 text-sm text-ink2">
        La carte se remplit au premier mois clos — le bilan du mois en cours reste secret jusqu&apos;à
        l&apos;antenne.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <StatTile
          label={`Total ${card.year}`}
          value={formatPointsLabel(card.yearTotal)}
          tone={card.yearTotal > 0 ? "good" : card.yearTotal < 0 ? "bad" : "default"}
          hint={card.yearTotal === 0 ? "les mois clos de l'année" : undefined}
        />
        <StatTile
          label="Meilleur mois"
          value={formatPointsLabel(bestMonth.total)}
          hint={<span className="capitalize">{formatMonthFrench(bestMonth.month)}</span>}
        />
        <StatTile label="Lectures" value={card.readingCount} hint="terminées, mois clos" />
        <StatTile label="Distinctions" value={totalDistinctions} hint="tous mois confondus" />
      </div>
      {totalDistinctions > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {ALL_PICK_KINDS.filter((kind) => card.distinctionCounts[kind] > 0).map((kind) => (
            <Badge key={kind} state={PICK_KIND_BADGE_STATE[kind]}>
              {card.distinctionCounts[kind]} × {PICK_KIND_LABELS[kind]}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
