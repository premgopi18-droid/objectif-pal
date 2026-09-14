"use client";

import { useCallback, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { ErrorAlert } from "@/components/error-alert";
import { MergeBanner } from "@/components/series/merge-banner";
import { SeriesCard } from "@/components/series/series-card";
import { SeriesSheet } from "@/components/series/series-sheet";
import { FilterChips } from "@/components/ui/filter-chips";
import { Toast } from "@/components/ui/toast";
import { NETWORK_ERROR_MESSAGE } from "@/lib/books/errors";
import { setVolumeNumber } from "@/lib/books/library-actions";
import { declareSeriesFact, mergeSeries, renameSeries } from "@/lib/series/actions";
import {
  DEFAULT_SERIES_FILTER,
  SERIES_FILTER_LABELS,
  matchesSeriesFilter,
  seriesHeadline,
  seriesToasts,
  type SeriesFilter,
} from "@/lib/series/copy";
import { findMergeCandidates, pairKey } from "@/lib/series/merge-candidates";
import { categoryChips, filterSeriesByQueryAndCategory, type SeriesCategoryFilter } from "@/lib/series/filter";
import type { SeriesSegmentData } from "@/lib/series/queries";

/**
 * Le segment « Séries » de la Bibliothèque (lot B de l'epic #289, §4.17) :
 * synthèse, chips, bannière de fusion, cartes triées par dette, et la fiche
 * en overlay. Les gestes appellent les actions serveur du référentiel ; la
 * page se re-dérive au retour (revalidatePath) — rien n'est recalculé ici.
 *
 * « Ce sont deux séries » vit en localStorage : une décision de confort, pas
 * un fait — comme la dernière série mémorisée du scan (#35).
 */

const FILTER_CHIPS = (["all", "not-started", "in-progress", "up-to-date", "complete"] as const).map((value) => ({
  value,
  label: SERIES_FILTER_LABELS[value],
}));

const IGNORED_PAIRS_STORAGE_KEY = "objectif-pal.series-merge-ignored";
const NO_IGNORED_PAIRS = "[]";

/**
 * Les paires ignorées, en localStorage, lues par `useSyncExternalStore` : le
 * serveur rend sans (snapshot vide), le client hydrate puis relit — pas de
 * setState dans un effet, pas de décalage d'hydratation sur la bannière.
 */
const ignoredPairsListeners = new Set<() => void>();

function readIgnoredPairsRaw(): string {
  try {
    return window.localStorage.getItem(IGNORED_PAIRS_STORAGE_KEY) ?? NO_IGNORED_PAIRS;
  } catch {
    return NO_IGNORED_PAIRS;
  }
}

function subscribeIgnoredPairs(listener: () => void): () => void {
  ignoredPairsListeners.add(listener);
  return () => {
    ignoredPairsListeners.delete(listener);
  };
}

function writeIgnoredPairs(pairs: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(IGNORED_PAIRS_STORAGE_KEY, JSON.stringify([...pairs]));
  } catch {
    // Navigation privée, quota : la mémoire de confort n'est pas vitale.
  }
  for (const listener of ignoredPairsListeners) listener();
}

function parseIgnoredPairs(raw: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

export function SeriesView({ data, focusSeriesId = null }: { data: SeriesSegmentData; focusSeriesId?: string | null }) {
  const [filter, setFilter] = useState<SeriesFilter>(DEFAULT_SERIES_FILTER);
  // Recherche et catégorie (#319) : état local du segment, comme la recherche de la Biblio — rien n'est persisté.
  const [searchText, setSearchText] = useState("");
  const [category, setCategory] = useState<SeriesCategoryFilter>("all");
  const [openSeriesId, setOpenSeriesId] = useState<string | null>(() =>
    focusSeriesId !== null && data.progress.some((progress) => progress.seriesId === focusSeriesId) ? focusSeriesId : null,
  );
  const ignoredPairsRaw = useSyncExternalStore(subscribeIgnoredPairs, readIgnoredPairsRaw, () => NO_IGNORED_PAIRS);
  const ignoredPairs = useMemo(() => parseIgnoredPairs(ignoredPairsRaw), [ignoredPairsRaw]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const gcdLinked = useMemo(() => new Set(data.gcdLinkedSeriesIds), [data.gcdLinkedSeriesIds]);
  // Les séries au seuil (§4.17-6) et, repliées en bas, celles d'un tome sans
  // fait : la porte vers leur fiche, pour déclarer (vécu sur Dungeon Crawler
  // Carl — un tome seul n'était joignable nulle part).
  const shown = useMemo(() => data.progress.filter((progress) => progress.isVisible), [data.progress]);
  // Le bandeau de synthèse et les chips de catégorie décrivent le PARC, pas la vue.
  const debt = useMemo(() => shown.reduce((sum, progress) => sum + progress.pile, 0), [shown]);
  const categories = useMemo(() => categoryChips(shown), [shown]);
  // Recherche + catégorie s'appliquent aux visibles ET aux repliées ; l'état, aux visibles seulement.
  const searched = useMemo(() => filterSeriesByQueryAndCategory(shown, { query: searchText, category }), [shown, searchText, category]);
  const hidden = useMemo(
    () => filterSeriesByQueryAndCategory(data.progress.filter((progress) => !progress.isVisible), { query: searchText, category }),
    [data.progress, searchText, category],
  );
  const visible = useMemo(() => searched.filter((progress) => matchesSeriesFilter(progress, filter)), [searched, filter]);
  const isFiltering = searchText.trim() !== "" || category !== "all";
  const counts = useMemo(
    () =>
      FILTER_CHIPS.map((chip) => ({
        ...chip,
        // Les compteurs disent ce qu'il reste après recherche et catégorie.
        label: `${chip.label} ${searched.filter((progress) => matchesSeriesFilter(progress, chip.value)).length}`,
      })),
    [searched],
  );
  const mergePair = useMemo(
    () =>
      findMergeCandidates(
        data.progress.map((progress) => ({
          seriesId: progress.seriesId,
          name: progress.name,
          volumeCount: progress.read + progress.pile,
          hasGcdId: gcdLinked.has(progress.seriesId),
        })),
        ignoredPairs,
      )[0] ?? null,
    [data.progress, gcdLinked, ignoredPairs],
  );
  const openProgress = useMemo(() => data.progress.find((progress) => progress.seriesId === openSeriesId) ?? null, [data.progress, openSeriesId]);
  const closeSheet = useCallback(() => {
    setOpenSeriesId(null);
    setErrorMessage(null);
  }, []);

  /** Un geste serveur → toast au succès, erreur affichée là où on est (fiche ou liste). */
  const run = (action: () => Promise<{ ok: true } | { ok: false; error: string }>, successToast: string) => {
    setErrorMessage(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setErrorMessage(result.error);
          return;
        }
        setToastMessage(successToast);
      } catch {
        setErrorMessage(NETWORK_ERROR_MESSAGE);
      }
    });
  };

  const numberVolume = async (bookId: string, rawNumber: string): Promise<boolean> => {
    try {
      const result = await setVolumeNumber(bookId, rawNumber);
      if (!result.ok) return false;
      setToastMessage(seriesToasts.volumeNumbered(result.issueNumber));
      return true;
    } catch {
      return false;
    }
  };

  const dismissPair = () => {
    if (!mergePair) return;
    writeIgnoredPairs(new Set(ignoredPairs).add(pairKey(mergePair)));
  };

  return (
    <div className="mt-4 flex flex-col gap-4">
      <p className="text-sm text-ink2">{seriesHeadline(shown.length, debt)}</p>

      {shown.length > 0 && (
        <>
          {/* Recherche + type sur une rangée, comme recherche + tri dans « Tous » (#321) ; les chips d'état défilent dessous. */}
          <div className="flex gap-2">
            <input
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Rechercher une série…"
              aria-label="Rechercher une série"
              className="min-w-0 flex-1 rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink placeholder:text-ink3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
            />
            {/* « Tous les types » + au moins deux catégories : une seule catégorie ne se filtre pas. */}
            {categories.length > 2 && (
              <select
                aria-label="Filtrer les séries par type"
                value={category}
                onChange={(event) => setCategory(event.target.value as SeriesCategoryFilter)}
                className="max-w-[45%] flex-none rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
              >
                {categories.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          <FilterChips chips={counts} value={filter} onChange={setFilter} label="Filtrer les séries par état" />
        </>
      )}

      {errorMessage !== null && openProgress === null && <ErrorAlert message={errorMessage} />}

      {mergePair !== null && (
        <MergeBanner
          pair={mergePair}
          isPending={isPending}
          onDismiss={dismissPair}
          onMerge={() =>
            run(
              () => mergeSeries(mergePair.keep.seriesId, mergePair.merge.seriesId),
              seriesToasts.merged(mergePair.keep.name, mergePair.keep.volumeCount + mergePair.merge.volumeCount),
            )
          }
        />
      )}

      {shown.length === 0 && hidden.length === 0 ? (
        <p className="py-8 text-center text-sm leading-relaxed text-ink2">
          Une série apparaît ici à partir de deux tomes — scanne la suite, ou renseigne la série d&apos;un livre
          depuis « Modifier » dans Tous.
        </p>
      ) : shown.length === 0 ? null : visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink2">{isFiltering ? "Aucune série ne correspond." : "Aucune série dans cet état."}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((progress) => (
            <li key={progress.seriesId}>
              <SeriesCard progress={progress} onOpen={() => setOpenSeriesId(progress.seriesId)} />
            </li>
          ))}
        </ul>
      )}

      {hidden.length > 0 && (
        <details className="rounded-card border border-line bg-card p-3">
          <summary className="cursor-pointer text-sm font-semibold text-ink2">
            {hidden.length} série{hidden.length > 1 ? "s" : ""} d&apos;un seul tome, dont aucune source ne sait rien — ouvrir pour déclarer
          </summary>
          <ul className="mt-3 flex flex-col gap-3">
            {hidden.map((progress) => (
              <li key={progress.seriesId}>
                <SeriesCard progress={progress} onOpen={() => setOpenSeriesId(progress.seriesId)} />
              </li>
            ))}
          </ul>
        </details>
      )}

      {openProgress !== null && (
        <SeriesSheet
          progress={openProgress}
          declarerLabel={openProgress.factDeclaredBy ? (data.declarerLabels[openProgress.factDeclaredBy] ?? null) : null}
          humanDeclarerLabel={openProgress.humanDeclaredBy ? (data.declarerLabels[openProgress.humanDeclaredBy] ?? null) : null}
          isPending={isPending}
          errorMessage={errorMessage}
          onClose={closeSheet}
          onDeclareTotal={(total) =>
            run(() => declareSeriesFact(openProgress.seriesId, { totalVolumes: total }), seriesToasts.totalDeclared(openProgress.name, total))
          }
          onDeclareOngoing={() =>
            run(() => declareSeriesFact(openProgress.seriesId, { isOngoing: true }), seriesToasts.ongoingDeclared(openProgress.name))
          }
          onRename={(name) => run(() => renameSeries(openProgress.seriesId, name), seriesToasts.renamed(name))}
          onNumberVolume={numberVolume}
        />
      )}

      <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </div>
  );
}
