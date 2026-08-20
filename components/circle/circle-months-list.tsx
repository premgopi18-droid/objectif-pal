import Link from "next/link";
import { MonthReportCard } from "@/components/circle/month-report-card";
import { PalisteCard } from "@/components/profile/paliste-card";
import { Card } from "@/components/ui/card";
import type { CircleParticipant } from "@/lib/circle/report-queries";
import { formatMonthFrench } from "@/lib/dates";
import { derivePalisteCard } from "@/lib/profile/paliste-card";

/**
 * La carte de paliste + les mois clos d'UN participant, tels que SERVIS —
 * le rendu partagé entre la fiche ami (§4.14, lot B) et le mode spectateur
 * (#252). Même composant, mêmes lignes d'entrée : ce que je vois de moi en
 * spectateur est structurellement ce qu'un ami voit — la garantie n'est pas
 * une promesse d'UI, c'est la construction.
 *
 * Trois états par mois, jamais confondus : plein / 🔒 verrouillé / illisible.
 * En spectateur, le mois verrouillé pointe vers le bouton « Révéler au
 * cercle » du Bilan — on ne révèle plus à l'aveugle, on vérifie.
 */
export function CircleMonthsList({ participant, spectator = false }: { participant: CircleParticipant; spectator?: boolean }) {
  // Les mois verrouillés (#243) figurent dans la liste : l'existence sans la
  // donnée — « le bilan arrive ».
  const months = [
    ...new Set([...Object.keys(participant.reportsByMonth), ...participant.unreadableMonths, ...participant.lockedMonths]),
  ]
    .sort()
    .reverse();

  if (months.length === 0) {
    return (
      <p className="text-sm text-ink2">
        {spectator
          ? "Rien encore — ton cercle verra ton premier mois clos ici. Le mois en cours reste secret jusqu'au bilan."
          : "Rien encore — les bilans apparaissent au premier mois clos. Le mois en cours reste secret jusqu'au bilan."}
      </p>
    );
  }

  // La carte de paliste — les picks servis sont déjà « mois clos révélés
  // seulement » (RPC), le mois courant est celui du serveur (UTC).
  const card = derivePalisteCard(
    Object.values(participant.reportsByMonth),
    Object.entries(participant.picksByMonth).flatMap(([month, picks]) => picks.map((pick) => ({ month, kind: pick.kind }))),
    new Date().toISOString().slice(0, 7),
  );

  return (
    <div className="flex flex-col gap-4">
      <PalisteCard card={card} />
      {months.map((month) => {
        const stored = participant.reportsByMonth[month];
        return (
          <div key={month}>
            <h2 className="mb-2 text-sm font-extrabold capitalize text-ink2">{formatMonthFrench(month)}</h2>
            <Card>
              {stored !== undefined ? (
                <MonthReportCard
                  stored={stored}
                  picks={participant.picksByMonth[month] ?? []}
                  ownerDisplayName={participant.displayName}
                />
              ) : participant.lockedMonths.includes(month) ? (
                spectator ? (
                  <p className="text-sm text-ink3">
                    🔒 Pas encore révélé — ton cercle ne voit pas ce mois. Le bouton « Révéler au cercle » est
                    au{" "}
                    <Link href="/bilan" className="font-bold text-cyan underline">
                      Bilan
                    </Link>
                    , sinon la bascule se fait toute seule au 1ᵉʳ du mois prochain.
                  </p>
                ) : (
                  <p className="text-sm text-ink3">
                    🔒 Pas encore révélé — le bilan de {participant.displayName} arrive (au plus tard le 1ᵉʳ du
                    mois prochain).
                  </p>
                )
              ) : (
                <p className="text-sm text-ink3">Bilan indisponible pour ce mois.</p>
              )}
            </Card>
          </div>
        );
      })}
    </div>
  );
}
