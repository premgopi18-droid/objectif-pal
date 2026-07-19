"use client";

import { useMemo } from "react";
import { PalCurve } from "@/components/stats/pal-curve";
import { Card } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { CATEGORY_LABELS } from "@/lib/books/categories";
import { formatMonthFrench, localCurrentMonth, localToday } from "@/lib/dates";
import type { BookCategory } from "@/lib/scoring/types";
import {
  computeStats,
  MIN_RATED_READINGS_TO_RANK,
  STALLED_READING_DAYS,
  type RatedGroup,
  type StatBookRecord,
} from "@/lib/stats/compute-stats";
import { fillMonthGaps } from "@/lib/stats/fill-month-gaps";
import type { ReadingEventFact } from "@/lib/stats/reading-events";

/**
 * La vue Stats — les quatre sections dans l'ordre de lecture antenne (specs
 * §4.5) : santé de la PAL, volume, répartition, goûts. Composant client comme
 * le bilan : le « mois courant » vient du fuseau de l'APPAREIL, le moteur pur
 * fait tout le calcul. Rhabillage refonte #71 : tuiles `StatTile`, cartes
 * `Card`, courbe et barres aux tokens de la nuit du plateau.
 */

/** Au-delà, la liste des éditeurs se replie en « Autres » (lisibilité mobile). */
const TOP_PUBLISHERS_COUNT = 5;

/** Combien de séries affichées dans la répartition par série (lisibilité mobile). */
const TOP_SERIES_COUNT = 6;

/** Combien de lignes en tête et en queue des classements de goûts, et de mois affichés. */
const TASTES_LIST_COUNT = 3;
const RANKING_COUNT = 5;
const RECENT_EVENT_MONTHS_COUNT = 6;

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

/**
 * Les teintes des séries — mêmes tokens que les catégories, en ordre FIXE et
 * choisies par hachage du nom : une série garde sa couleur d'un rendu à l'autre
 * (règle « la couleur suit l'entité, jamais son rang »). La liste étant coupée
 * à `TOP_SERIES_COUNT`, on ne dépasse jamais la palette.
 */
const SERIES_BAR_COLORS = ["var(--violet)", "var(--cyan)", "var(--magenta)", "var(--green)", "var(--amber)"] as const;

function seriesBarColor(seriesName: string): string {
  let hash = 0;
  for (let index = 0; index < seriesName.length; index += 1) {
    hash = (hash * 31 + seriesName.charCodeAt(index)) % 100_000;
  }
  return SERIES_BAR_COLORS[hash % SERIES_BAR_COLORS.length];
}

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

/** Une durée en jours → « 12 j » (arrondi UI à l'entier, le moteur n'arrondit pas). */
function formatDays(value: number): string {
  return `${Math.round(value)} j`;
}

/** Une ligne « libellé — barre — compte » : la barre décore, le chiffre informe. */
function BarLine({ label, count, max, color }: { label: string; count: number; max: number; color: string }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-2.5 text-[13px]">
      <span className="truncate text-ink2">{label}</span>
      {/* Décor de magnitude : le compte est déjà lisible en chiffre à droite. */}
      <div aria-hidden className="h-2.5 overflow-hidden rounded-full bg-card2">
        <div className="h-full rounded-full" style={{ width: `${(count / max) * 100}%`, background: color }} />
      </div>
      <span className="text-right font-bold tabular-nums text-ink">{count}</span>
    </div>
  );
}

/** Une liste « nom · moyenne » — les meilleures séries, les éditeurs décevants… */
function RatedGroupList({ title, groups }: { title: string; groups: RatedGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ink3">{title}</h3>
      <ul>
        {groups.map((group) => (
          <li key={group.name} className="flex items-baseline justify-between gap-3 py-1 text-sm">
            <span className="truncate text-ink2">{group.name}</span>
            <span className="shrink-0 font-bold tabular-nums text-amber">
              ★ {formatRating(group.average)}
              <span className="ml-1 font-normal text-ink3">({group.ratedCount})</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type StatsViewProps = {
  records: StatBookRecord[];
  /** Le journal d'états — abandons & reprises (#30 lot A). Vide si indisponible. */
  readingEvents?: ReadingEventFact[];
};

export function StatsView({ records, readingEvents }: StatsViewProps) {
  const currentMonth = localCurrentMonth();
  const today = localToday();
  const report = useMemo(
    () => computeStats(records, currentMonth, { today, readingEvents }),
    [records, currentMonth, today, readingEvents],
  );
  const curvePoints = useMemo(() => fillMonthGaps(report.pal.cumulativeByMonth), [report]);

  const { pal, volume, breakdown, ratings, rythme, series, tastes, monthly } = report;

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

  // Analyses avancées (#30) — le moteur a déjà tout trié : la vue ne fait que
  // couper les listes à une longueur lisible sur mobile.
  const ratedDurations = (
    Object.entries(rythme.averageDurationByCategory) as [BookCategory, number | null][]
  ).filter((entry): entry is [BookCategory, number] => entry[1] !== null);
  const topSeries = series.volumesRead.slice(0, TOP_SERIES_COUNT);
  const maxSeriesCount = Math.max(1, ...topSeries.map(({ count }) => count));
  const recentEventMonths = rythme.eventsByMonth.slice(-RECENT_EVENT_MONTHS_COUNT);
  // Les deux bouts de la MÊME liste triée — jamais la même série des deux côtés
  // (avec moins de 2 × N groupes classés, on ne montre que les meilleurs).
  const bestSeries = tastes.series.slice(0, TASTES_LIST_COUNT);
  const worstSeries = tastes.series.slice(Math.max(TASTES_LIST_COUNT, tastes.series.length - TASTES_LIST_COUNT));
  const bestPublishers = tastes.publishers.slice(0, TASTES_LIST_COUNT);
  const worstPublishers = tastes.publishers.slice(
    Math.max(TASTES_LIST_COUNT, tastes.publishers.length - TASTES_LIST_COUNT),
  );
  const hasRankedTastes = tastes.series.length > 0 || tastes.publishers.length > 0;
  const topRanking = tastes.ranking.slice(0, RANKING_COUNT);
  const datedReadingsCount = volume.finishedTotal - rythme.readingsWithoutDuration;

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
        <SectionLabel>Au fil des mois</SectionLabel>
        {monthly.averagePerMonth === null || monthly.bestMonth === null ? (
          <Card className="text-sm text-ink2">Pas encore de lecture terminée.</Card>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <StatTile
              label="Par mois"
              value={formatRating(monthly.averagePerMonth)}
              hint="moyenne depuis la première lecture"
            />
            <StatTile
              label="Meilleur mois"
              value={monthly.bestMonth.count}
              tone="amber"
              hint={formatMonthFrench(monthly.bestMonth.month)}
            />
          </div>
        )}
      </section>

      <section>
        <SectionLabel>Rythme</SectionLabel>
        {rythme.averageDurationDays === null ? (
          <Card className="text-sm text-ink2">Pas encore de lecture datée du début à la fin.</Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <StatTile
                label="Durée moyenne"
                value={formatDays(rythme.averageDurationDays)}
                hint={`sur ${datedReadingsCount} lecture${datedReadingsCount > 1 ? "s" : ""} datée${
                  datedReadingsCount > 1 ? "s" : ""
                }`}
              />
              <StatTile
                label="En cours qui traînent"
                value={rythme.stalledReadings.length}
                hint={`depuis plus de ${STALLED_READING_DAYS} jours`}
              />
            </div>
            {ratedDurations.length > 0 && (
              <Card className="mt-3">
                <h3 className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ink3">Par catégorie</h3>
                <ul className="flex flex-col gap-1">
                  {ratedDurations.map(([category, average]) => (
                    <li key={category} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-ink2">{CATEGORY_LABELS[category]}</span>
                      <span className="font-bold tabular-nums text-ink">{formatDays(average)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}

        {/* La liste CALME (décision produit du 19/07/2026) : on constate, on n'alarme pas. */}
        {rythme.stalledReadings.length > 0 && (
          <Card className="mt-3">
            <h3 className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ink3">
              Commencées il y a un moment
            </h3>
            <ul>
              {rythme.stalledReadings.map((reading) => (
                <li key={reading.bookId} className="flex items-baseline justify-between gap-3 py-1 text-sm">
                  <span className="truncate text-ink2">{reading.title}</span>
                  <span className="shrink-0 tabular-nums text-ink3">{formatDays(reading.daysSinceStart)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {recentEventMonths.length > 0 && (
          <Card className="mt-3">
            <h3 className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ink3">Abandons & reprises</h3>
            <ul className="flex flex-col gap-1">
              {recentEventMonths.map((month) => (
                <li key={month.month} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate text-ink2">{formatMonthFrench(month.month)}</span>
                  <span className="shrink-0 tabular-nums text-ink">
                    <span className="text-ink3">abandons</span>{" "}
                    <span className="font-bold">{month.abandons}</span>{" "}
                    <span className="text-ink3">· reprises</span>{" "}
                    <span className="font-bold">{month.resumptions}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section>
        <SectionLabel>Répartition</SectionLabel>
        {volume.finishedTotal === 0 ? (
          <Card className="text-sm text-ink2">Pas encore de lecture terminée.</Card>
        ) : (
          <Card className="flex flex-col gap-2.5">
            <div
              className="flex flex-col gap-2.5"
              role="group"
              aria-label="Lectures terminées par catégorie, en nombre de lectures"
            >
              {categoryLines.map(([category, count]) => (
                <BarLine
                  key={category}
                  label={CATEGORY_LABELS[category]}
                  count={count}
                  max={maxCategoryCount}
                  color={CATEGORY_BAR_COLOR[category]}
                />
              ))}
            </div>
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
            {topSeries.length > 0 && (
              <div
                className="mt-1.5 flex flex-col gap-2.5 border-t border-line pt-3"
                role="group"
                aria-label={`Tomes lus par série, ${topSeries.length} série${topSeries.length > 1 ? "s" : ""} affichée${
                  topSeries.length > 1 ? "s" : ""
                }`}
              >
                <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink3">Par série</h3>
                {topSeries.map(({ seriesName, count }) => (
                  <BarLine
                    key={seriesName}
                    label={seriesName}
                    count={count}
                    max={maxSeriesCount}
                    color={seriesBarColor(seriesName)}
                  />
                ))}
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

            {/* Goûts avancés (#30 lot C) : rien n'est classé sous le seuil de volume. */}
            {hasRankedTastes ? (
              <Card className="mt-3 flex flex-col gap-3">
                <RatedGroupList title="Mes meilleures séries" groups={bestSeries} />
                <RatedGroupList title="Celles qui me déçoivent" groups={worstSeries} />
                <RatedGroupList title="Mes meilleurs éditeurs" groups={bestPublishers} />
                <RatedGroupList title="Ceux qui me déçoivent" groups={worstPublishers} />
              </Card>
            ) : (
              <Card className="mt-3 text-sm text-ink2">
                Pas assez de notes pour classer séries et éditeurs — il en faut au moins{" "}
                {MIN_RATED_READINGS_TO_RANK} par série ou éditeur.
              </Card>
            )}

            {topRanking.length > 0 && (
              <Card className="mt-3">
                <h3 className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ink3">
                  Mes lectures les mieux notées
                </h3>
                <ol>
                  {topRanking.map((reading, index) => (
                    <li
                      key={`${reading.bookId}-${reading.finishedAt}`}
                      className="flex items-baseline justify-between gap-3 py-1 text-sm"
                    >
                      <span className="truncate text-ink2">
                        <span className="mr-1.5 tabular-nums text-ink3">{index + 1}.</span>
                        {reading.title}
                      </span>
                      <span className="shrink-0 font-bold tabular-nums text-amber">
                        ★ {formatRating(reading.rating)}
                      </span>
                    </li>
                  ))}
                </ol>
              </Card>
            )}
          </>
        )}
      </section>
    </div>
  );
}
