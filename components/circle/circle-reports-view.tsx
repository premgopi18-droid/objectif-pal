"use client";

import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import { useMemo, useState } from "react";
import { MonthReportCard } from "@/components/circle/month-report-card";
import { Card } from "@/components/ui/card";
import { circleMonths, rankParticipants, yearTotal, type RankedEntry } from "@/lib/circle/ranking";
import type { CircleParticipant } from "@/lib/circle/report-queries";
import { formatMonthFrench } from "@/lib/dates";
import { formatPointsLabel } from "@/lib/scoring/report-text";

/**
 * Les bilans comparés du cercle (§4.14, lot B) — moi + mes amis, mois clos
 * par mois clos, et le cumul de l'année civile. Deux règles de spec rendues
 * ici : ex-aequo = même rang, et « — » hors rang quand un membre n'a pas de
 * ligne pour la période (jamais un zéro inventé). Tout est dérivé des props
 * serveur — aucune requête côté client.
 */

const SECTION_LABEL = "text-xs font-extrabold uppercase tracking-[0.1em] text-ink3";

type CircleReportsViewProps = {
  participants: CircleParticipant[];
  /** L'année du cumul — `YYYY`, calculée côté serveur (UTC, même convention que la synchro). */
  currentYear: string;
};

export function CircleReportsView({ participants, currentYear }: CircleReportsViewProps) {
  const months = useMemo(
    () => circleMonths(participants.map((participant) => Object.keys(participant.reportsByMonth))),
    [participants],
  );
  const [monthIndex, setMonthIndex] = useState(0); // 0 = le plus récent
  const [openParticipantId, setOpenParticipantId] = useState<string | null>(null);
  // Clamp : si la liste des mois rétrécit entre deux revalidations, l'index
  // retombe sur un mois existant plutôt que sur un trou.
  const selectedMonth = months[Math.min(monthIndex, months.length - 1)] ?? null;

  const monthRanking = useMemo(() => {
    if (selectedMonth === null) return [];
    // L'ordre d'entrée (par pseudo, fourni par le serveur) départage les
    // ex-aequo et ordonne les « — » : déterministe des deux côtés.
    return rankParticipants(
      participants.map((participant) => ({
        participantId: participant.id,
        score: participant.reportsByMonth[selectedMonth]?.report.total ?? null,
      })),
    );
  }, [participants, selectedMonth]);

  const yearRanking = useMemo(
    () =>
      rankParticipants(
        participants.map((participant) => ({
          participantId: participant.id,
          score: yearTotal(
            Object.values(participant.reportsByMonth).map(({ report }) => ({
              month: report.month,
              total: report.total,
            })),
            currentYear,
          ),
        })),
      ),
    [participants, currentYear],
  );

  const participantById = useMemo(
    () => new Map(participants.map((participant) => [participant.id, participant])),
    [participants],
  );

  if (months.length === 0) {
    return (
      <Card>
        <p className="text-sm text-ink2">
          Aucun mois clos dans le cercle pour l&apos;instant — les bilans comparés commencent au premier mois
          terminé. Le mois en cours, lui, reste secret jusqu&apos;au bilan.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        {/* La navigation de mois — même geste qu'au Bilan. */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              setMonthIndex((index) => Math.min(index + 1, months.length - 1));
              setOpenParticipantId(null);
            }}
            disabled={monthIndex >= months.length - 1}
            aria-label="Mois précédent"
            className="grid size-11 place-items-center rounded-xl border border-line bg-card text-ink2 transition active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan disabled:opacity-30 disabled:active:scale-100"
          >
            <ChevronLeft aria-hidden className="size-5" />
          </button>
          <h2 className="text-[17px] font-extrabold capitalize text-ink">
            {selectedMonth !== null && formatMonthFrench(selectedMonth)}
          </h2>
          <button
            type="button"
            onClick={() => {
              setMonthIndex((index) => Math.max(index - 1, 0));
              setOpenParticipantId(null);
            }}
            disabled={monthIndex === 0}
            aria-label="Mois suivant"
            className="grid size-11 place-items-center rounded-xl border border-line bg-card text-ink2 transition active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan disabled:opacity-30 disabled:active:scale-100"
          >
            <ChevronRight aria-hidden className="size-5" />
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {monthRanking.map((entry) => {
            const participant = participantById.get(entry.participantId);
            if (participant === undefined) return null;
            const stored = selectedMonth !== null ? participant.reportsByMonth[selectedMonth] : undefined;
            const isUnreadable =
              selectedMonth !== null && stored === undefined && participant.unreadableMonths.includes(selectedMonth);
            const isOpen = openParticipantId === participant.id;
            return (
              <Card key={participant.id} className="p-0">
                <button
                  type="button"
                  onClick={() => setOpenParticipantId(isOpen ? null : participant.id)}
                  disabled={stored === undefined}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 rounded-card p-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan disabled:cursor-default"
                >
                  <RankBadge entry={entry} />
                  <ParticipantAvatar displayName={participant.displayName} avatarUrl={participant.avatarUrl} />
                  <span className="min-w-0 flex-1 truncate text-sm font-bold">
                    {participant.displayName}
                    {participant.isMe && <span className="font-semibold text-ink3"> (moi)</span>}
                  </span>
                  <span className="shrink-0 text-sm font-black">
                    {stored !== undefined ? (
                      formatPointsLabel(stored.report.total)
                    ) : (
                      <span className="text-ink3">{isUnreadable ? "indisponible" : "—"}</span>
                    )}
                  </span>
                  {stored !== undefined && (
                    <ChevronDown
                      aria-hidden
                      className={`size-4 shrink-0 text-ink3 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    />
                  )}
                </button>
                {isOpen && stored !== undefined && selectedMonth !== null && (
                  <div className="border-t border-line p-3">
                    <MonthReportCard stored={stored} picks={participant.picksByMonth[selectedMonth] ?? []} />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
        <p className="text-xs text-ink3">
          « — » : pas de bilan pour ce mois. Un membre sans ligne reste hors classement — seul un mois joué se
          classe.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={SECTION_LABEL}>Cumul {currentYear}</h2>
        <Card className="flex flex-col gap-2 p-3">
          {yearRanking.map((entry) => {
            const participant = participantById.get(entry.participantId);
            if (participant === undefined) return null;
            return (
              <div key={participant.id} className="flex items-center gap-3">
                <RankBadge entry={entry} />
                <ParticipantAvatar displayName={participant.displayName} avatarUrl={participant.avatarUrl} />
                <span className="min-w-0 flex-1 truncate text-sm font-bold">
                  {participant.displayName}
                  {participant.isMe && <span className="font-semibold text-ink3"> (moi)</span>}
                </span>
                <span className="shrink-0 text-sm font-black">
                  {entry.score !== null ? formatPointsLabel(entry.score) : <span className="text-ink3">—</span>}
                </span>
              </div>
            );
          })}
        </Card>
      </section>
    </div>
  );
}

function RankBadge({ entry }: { entry: RankedEntry }) {
  return (
    <span
      aria-label={entry.rank === null ? "hors classement" : entry.rank === 1 ? "1er" : `${entry.rank}e`}
      className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-black ${
        entry.rank === 1 ? "bg-grad text-bg0" : "border border-line bg-card2 text-ink2"
      }`}
    >
      {entry.rank ?? "—"}
    </span>
  );
}

function ParticipantAvatar({ displayName, avatarUrl }: { displayName: string; avatarUrl: string | null }) {
  if (avatarUrl !== null) {
    return (
      <Image src={avatarUrl} alt="" width={32} height={32} unoptimized className="size-8 shrink-0 rounded-full object-cover" />
    );
  }
  return (
    <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-grad text-sm font-black text-bg0">
      {displayName.charAt(0).toUpperCase()}
    </span>
  );
}
