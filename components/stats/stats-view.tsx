"use client";

import { useMemo } from "react";
import { PalCurve } from "@/components/stats/pal-curve";
import { CATEGORY_LABELS } from "@/lib/books/categories";
import { localCurrentMonth } from "@/lib/dates";
import type { BookCategory } from "@/lib/scoring/types";
import { computeStats, type StatBookRecord } from "@/lib/stats/compute-stats";
import { fillMonthGaps } from "@/lib/stats/fill-month-gaps";

/**
 * La vue Stats — les quatre sections dans l'ordre de lecture antenne (specs
 * §4.5) : santé de la PAL, volume, répartition, goûts. Composant client comme
 * le bilan : le « mois courant » vient du fuseau de l'APPAREIL, le moteur pur
 * fait tout le calcul.
 */

/** Au-delà, la liste des éditeurs se replie en « Autres » (lisibilité mobile). */
const TOP_PUBLISHERS_COUNT = 5;

/** Moyenne → « 4,3 » : arrondi UI à une décimale, virgule française (le moteur n'arrondit pas). */
function formatRating(value: number): string {
  return String(Math.round(value * 10) / 10).replace(".", ",");
}

/** `12345` → `12 345` (espace fine insécable) — déterministe, même rendu serveur/client. */
function formatInteger(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-2 rounded-xl border border-foreground/10 p-4">{children}</div>
    </section>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-0.5 rounded-lg bg-foreground/5 px-2 py-3">
      <span className="font-mono text-xl font-bold">{value}</span>
      <span className="text-center text-xs opacity-70">{label}</span>
    </div>
  );
}

type StatsViewProps = {
  records: StatBookRecord[];
};

export function StatsView({ records }: StatsViewProps) {
  const currentMonth = localCurrentMonth();
  const report = useMemo(() => computeStats(records, currentMonth), [records, currentMonth]);
  const curvePoints = useMemo(() => fillMonthGaps(report.pal.cumulativeByMonth), [report]);

  const { pal, volume, breakdown, ratings } = report;

  const categoryLines = (Object.entries(breakdown.byCategory) as [BookCategory, number][]).filter(
    ([, count]) => count > 0,
  );
  const topPublishers = breakdown.byPublisher.slice(0, TOP_PUBLISHERS_COUNT);
  const otherPublishersCount = breakdown.byPublisher
    .slice(TOP_PUBLISHERS_COUNT)
    .reduce((total, { count }) => total + count, 0);
  const ratedCategories = (Object.entries(ratings.averageByCategory) as [BookCategory, number | null][]).filter(
    (entry): entry is [BookCategory, number] => entry[1] !== null,
  );
  const knownPagesCount = volume.finishedTotal - volume.booksWithoutPageCount;

  return (
    <div className="mt-1">
      <SectionCard title="Santé de la PAL">
        <div className="flex items-baseline justify-between">
          <span>Taille de la pile</span>
          <span className="font-mono text-2xl font-bold text-amber-500">{pal.currentSize}</span>
        </div>
        <p className="mt-1 text-sm opacity-70">
          Ce mois-ci : {pal.monthEntries} entrée{pal.monthEntries > 1 ? "s" : ""} · {pal.monthExits} sortie
          {pal.monthExits > 1 ? "s" : ""} — solde {pal.monthBalance > 0 ? "+" : ""}
          {pal.monthBalance}
        </p>
        <div className="mt-3">
          <PalCurve points={curvePoints} />
        </div>
        {pal.readOutsidePalCount > 0 && (
          <p className="mt-2 text-sm opacity-70">
            {pal.readOutsidePalCount} lecture{pal.readOutsidePalCount > 1 ? "s" : ""} hors PAL (emprunt
            {pal.readOutsidePalCount > 1 ? "s" : ""} — livres jamais possédés).
          </p>
        )}
      </SectionCard>

      <SectionCard title="Volume">
        {volume.finishedTotal === 0 ? (
          <p className="text-sm opacity-70">Pas encore de lecture terminée.</p>
        ) : (
          <>
            <div className="flex gap-2">
              <StatTile label="Ce mois-ci" value={String(volume.finishedThisMonth)} />
              <StatTile label="Cette année" value={String(volume.finishedThisYear)} />
              <StatTile label="Au total" value={String(volume.finishedTotal)} />
            </div>
            {volume.pagesRead > 0 && (
              <p className="mt-3 text-sm">
                {formatInteger(volume.pagesRead)} pages lues
                {volume.booksWithoutPageCount > 0 && (
                  <span className="opacity-60">
                    {" "}
                    — sur {knownPagesCount} lecture{knownPagesCount > 1 ? "s" : ""} où c&apos;est connu
                  </span>
                )}
              </p>
            )}
          </>
        )}
      </SectionCard>

      <SectionCard title="Répartition">
        {volume.finishedTotal === 0 ? (
          <p className="text-sm opacity-70">Pas encore de lecture terminée.</p>
        ) : (
          <>
            <ul>
              {categoryLines.map(([category, count]) => (
                <li key={category} className="flex items-baseline justify-between py-1">
                  <span>{CATEGORY_LABELS[category]}</span>
                  <span className="font-mono text-sm">× {count}</span>
                </li>
              ))}
            </ul>
            {topPublishers.length > 0 && (
              <>
                <h3 className="mt-3 text-sm font-semibold opacity-70">Par éditeur</h3>
                <ul>
                  {topPublishers.map(({ publisher, count }) => (
                    <li key={publisher} className="flex items-baseline justify-between py-1">
                      <span className="truncate">{publisher}</span>
                      <span className="font-mono text-sm">× {count}</span>
                    </li>
                  ))}
                  {otherPublishersCount > 0 && (
                    <li className="flex items-baseline justify-between py-1 opacity-60">
                      <span>Autres</span>
                      <span className="font-mono text-sm">× {otherPublishersCount}</span>
                    </li>
                  )}
                </ul>
              </>
            )}
          </>
        )}
      </SectionCard>

      <SectionCard title="Goûts">
        {ratings.averageOverall === null ? (
          <p className="text-sm opacity-70">Pas encore de note.</p>
        ) : (
          <>
            <div className="flex gap-2">
              <StatTile label="Globale" value={`★ ${formatRating(ratings.averageOverall)}`} />
              <StatTile
                label="Ce mois-ci"
                value={ratings.averageThisMonth === null ? "—" : `★ ${formatRating(ratings.averageThisMonth)}`}
              />
              <StatTile
                label="Cette année"
                value={ratings.averageThisYear === null ? "—" : `★ ${formatRating(ratings.averageThisYear)}`}
              />
            </div>
            {ratedCategories.length > 0 && (
              <ul className="mt-3">
                {ratedCategories.map(([category, average]) => (
                  <li key={category} className="flex items-baseline justify-between py-1">
                    <span>{CATEGORY_LABELS[category]}</span>
                    <span className="font-mono text-sm">★ {formatRating(average)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </SectionCard>
    </div>
  );
}
