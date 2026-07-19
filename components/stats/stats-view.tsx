"use client";

import { useMemo } from "react";
import { PalCurve } from "@/components/stats/pal-curve";
import { Card } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { CATEGORY_LABELS } from "@/lib/books/categories";
import { localCurrentMonth } from "@/lib/dates";
import type { BookCategory } from "@/lib/scoring/types";
import { computeStats, type StatBookRecord } from "@/lib/stats/compute-stats";
import { fillMonthGaps } from "@/lib/stats/fill-month-gaps";

/**
 * La vue Stats — les quatre sections dans l'ordre de lecture antenne (specs
 * §4.5) : santé de la PAL, volume, répartition, goûts. Composant client comme
 * le bilan : le « mois courant » vient du fuseau de l'APPAREIL, le moteur pur
 * fait tout le calcul. Rhabillage refonte #71 : tuiles `StatTile`, cartes
 * `Card`, courbe et barres aux tokens de la nuit du plateau.
 */

/** Au-delà, la liste des éditeurs se replie en « Autres » (lisibilité mobile). */
const TOP_PUBLISHERS_COUNT = 5;

/**
 * Une couleur STABLE par catégorie (design-specs §5). Tirée des tokens du
 * dégradé signature : jamais de hex en dur (garde-fou §6). Chaque barre porte
 * aussi son libellé texte — l'identité n'est donc jamais portée par la seule
 * couleur (a11y CVD). Les catégories rares (issue, omnibus) reçoivent les teintes
 * sémantiques, qui cohabitent donc rarement avec les couleurs vives des
 * catégories courantes.
 */
const CATEGORY_BAR_COLOR: Record<BookCategory, string> = {
  issue: "var(--amber)",
  manga: "var(--magenta)",
  bd: "var(--cyan)",
  comics: "var(--violet)",
  omnibus: "var(--red)",
  roman: "var(--green)",
};

/** Moyenne → « 4,3 » : arrondi UI à une décimale, virgule française (le moteur n'arrondit pas). */
function formatRating(value: number): string {
  return String(Math.round(value * 10) / 10).replace(".", ",");
}

/** `12345` → `12 345` (espace fine insécable) — déterministe, même rendu serveur/client. */
function formatInteger(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Le solde signé : « +3 » gonfle (rouge), « −2 » dégonfle (vert), « 0 » stable. */
function formatSignedBalance(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${Math.abs(value)}`;
  return "0";
}

/** Le libellé de section (design-specs §2 « Typographie ») : 12px 800 majuscule, `--ink3`. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2.5 text-xs font-extrabold uppercase tracking-[0.1em] text-ink3">{children}</h2>;
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
  const maxCategoryCount = Math.max(1, ...categoryLines.map(([, count]) => count));
  const topPublishers = breakdown.byPublisher.slice(0, TOP_PUBLISHERS_COUNT);
  const otherPublishersCount = breakdown.byPublisher
    .slice(TOP_PUBLISHERS_COUNT)
    .reduce((total, { count }) => total + count, 0);
  const ratedCategories = (Object.entries(ratings.averageByCategory) as [BookCategory, number | null][]).filter(
    (entry): entry is [BookCategory, number] => entry[1] !== null,
  );
  const knownPagesCount = volume.finishedTotal - volume.booksWithoutPageCount;

  // Le solde qui gonfle est ROUGE, celui qui dégonfle VERT (design-specs §2).
  const balanceTone = pal.monthBalance > 0 ? "bad" : pal.monthBalance < 0 ? "good" : "default";

  return (
    <div className="mt-3 flex flex-col gap-6">
      <section>
        <SectionLabel>Santé de la PAL</SectionLabel>
        <div className="grid grid-cols-2 gap-3">
          <StatTile label="Dans la pile" value={pal.currentSize} tone="amber" />
          <StatTile
            label="Solde du mois"
            value={formatSignedBalance(pal.monthBalance)}
            tone={balanceTone}
            hint={`${pal.monthEntries} entrée${pal.monthEntries > 1 ? "s" : ""} · ${pal.monthExits} sortie${
              pal.monthExits > 1 ? "s" : ""
            }`}
          />
        </div>
        {pal.readOutsidePalCount > 0 && (
          <p className="mt-2 text-sm text-ink2">
            {pal.readOutsidePalCount} lecture{pal.readOutsidePalCount > 1 ? "s" : ""} hors PAL (emprunt
            {pal.readOutsidePalCount > 1 ? "s" : ""} — livres jamais possédés).
          </p>
        )}
      </section>

      <section>
        <SectionLabel>La courbe de la PAL</SectionLabel>
        <Card>
          <PalCurve points={curvePoints} />
        </Card>
      </section>

      <section>
        <SectionLabel>Volume</SectionLabel>
        {volume.finishedTotal === 0 ? (
          <Card className="text-sm text-ink2">Pas encore de lecture terminée.</Card>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <StatTile label="Ce mois-ci" value={volume.finishedThisMonth} />
              <StatTile label="Cette année" value={volume.finishedThisYear} />
              <StatTile label="Au total" value={volume.finishedTotal} />
            </div>
            {volume.pagesRead > 0 && (
              <p className="mt-3 text-sm text-ink">
                <span className="font-bold tabular-nums">{formatInteger(volume.pagesRead)}</span> pages lues
                {volume.booksWithoutPageCount > 0 && (
                  <span className="text-ink3">
                    {" "}
                    — sur {knownPagesCount} lecture{knownPagesCount > 1 ? "s" : ""} où c&apos;est connu
                  </span>
                )}
              </p>
            )}
          </>
        )}
      </section>

      <section>
        <SectionLabel>Répartition</SectionLabel>
        {volume.finishedTotal === 0 ? (
          <Card className="text-sm text-ink2">Pas encore de lecture terminée.</Card>
        ) : (
          <Card className="flex flex-col gap-2.5">
            {categoryLines.map(([category, count]) => (
              <div
                key={category}
                className="grid grid-cols-[4.5rem_1fr_2rem] items-center gap-2.5 text-[13px]"
              >
                <span className="truncate text-ink2">{CATEGORY_LABELS[category]}</span>
                {/* La barre : décor de magnitude, le compte est déjà en chiffre à droite. */}
                <div aria-hidden className="h-2.5 overflow-hidden rounded-full bg-card2">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(count / maxCategoryCount) * 100}%`, background: CATEGORY_BAR_COLOR[category] }}
                  />
                </div>
                <span className="text-right font-bold tabular-nums text-ink">{count}</span>
              </div>
            ))}
            {topPublishers.length > 0 && (
              <div className="mt-1.5 border-t border-line pt-3">
                <h3 className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ink3">Par éditeur</h3>
                <ul>
                  {topPublishers.map(({ publisher, count }) => (
                    <li key={publisher} className="flex items-baseline justify-between gap-3 py-1 text-sm">
                      <span className="truncate text-ink2">{publisher}</span>
                      <span className="shrink-0 font-bold tabular-nums text-ink">× {count}</span>
                    </li>
                  ))}
                  {otherPublishersCount > 0 && (
                    <li className="flex items-baseline justify-between gap-3 py-1 text-sm text-ink3">
                      <span>Autres</span>
                      <span className="shrink-0 font-bold tabular-nums">× {otherPublishersCount}</span>
                    </li>
                  )}
                </ul>
              </div>
            )}
          </Card>
        )}
      </section>

      <section>
        <SectionLabel>Goûts</SectionLabel>
        {ratings.averageOverall === null ? (
          <Card className="text-sm text-ink2">Pas encore de note.</Card>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <StatTile label="Globale" value={`★ ${formatRating(ratings.averageOverall)}`} tone="amber" />
              <StatTile
                label="Ce mois-ci"
                value={ratings.averageThisMonth === null ? "—" : `★ ${formatRating(ratings.averageThisMonth)}`}
                tone="amber"
              />
              <StatTile
                label="Cette année"
                value={ratings.averageThisYear === null ? "—" : `★ ${formatRating(ratings.averageThisYear)}`}
                tone="amber"
              />
            </div>
            {ratedCategories.length > 0 && (
              <Card className="mt-3">
                <ul className="flex flex-col gap-1">
                  {ratedCategories.map(([category, average]) => (
                    <li key={category} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-ink2">{CATEGORY_LABELS[category]}</span>
                      <span className="font-bold tabular-nums text-amber">★ {formatRating(average)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}
      </section>
    </div>
  );
}
