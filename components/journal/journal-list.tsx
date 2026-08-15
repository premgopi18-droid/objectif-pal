"use client";

import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import {
  abandonReading,
  finishReading,
  reopenReading,
  resumeReading,
  softDeleteReading,
  updateReadingDetails,
  type JournalActionResult,
} from "@/lib/books/journal-actions";
import { Badge } from "@/components/ui/badge";
import { BookRow } from "@/components/ui/book-row";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { burstConfetti } from "@/components/ui/confetti";
import { CategoryDrawer } from "@/components/scan/category-drawer";
import { FilterChips } from "@/components/ui/filter-chips";
import { Stars } from "@/components/ui/stars";
import { Toast } from "@/components/ui/toast";
import { CoverPhotoButton } from "@/components/cover-photo-button";
import { ErrorAlert } from "@/components/error-alert";
import { RemoveButton, useBookGestures } from "@/components/library/book-gestures";
import { FUTURE_DATE_MESSAGE } from "@/lib/books/errors";
import { ALL_CATEGORIES, CATEGORY_LABELS } from "@/lib/books/categories";
import { isHouseCoverPhotoUrl } from "@/lib/books/cover-photo";
import { formatBookSubtitle } from "@/lib/books/format";
import { formatDateFrench, formatMonthFrench, localToday } from "@/lib/dates";
import { formatPointsLabel } from "@/lib/scoring/report-text";
import { SCORING_SCALE } from "@/lib/scoring/scale";
import type { BookCategory, ReadingStatus } from "@/lib/scoring/types";
import type { ComponentProps } from "react";
import { monthSeparatorBefore, UNDATED_SEPARATOR } from "./month-separator";
import {
  DEFAULT_JOURNAL_SORT,
  JOURNAL_PAGE_SIZE,
  NO_JOURNAL_FILTERS,
  hasActiveJournalFilters,
  journalSearchString,
  type JournalFilters,
  type JournalSort,
} from "./journal-url";
import { SortSelect } from "@/components/ui/sort-select";
import { ENTRY_SORT_LABELS } from "@/lib/sort/entry-sort";

/**
 * Le délai avant d'envoyer la recherche au serveur (#222) : assez long pour ne
 * pas requêter à chaque frappe, assez court pour que la liste suive la saisie.
 */
const SEARCH_DEBOUNCE_MS = 350;

/** Les tris du journal (#217) — « Activité » (#146) reste le défaut. */
const JOURNAL_SORT_OPTIONS: { value: JournalSort; label: string }[] = [
  { value: "activite", label: "Activité" },
  { value: "lecture", label: "Date de lecture" },
  { value: "note", label: "Mieux notées" },
  { value: "ajout", label: ENTRY_SORT_LABELS.ajout },
  { value: "ajout-ancien", label: ENTRY_SORT_LABELS["ajout-ancien"] },
  { value: "titre", label: ENTRY_SORT_LABELS.titre },
  { value: "titre-inverse", label: ENTRY_SORT_LABELS["titre-inverse"] },
];

/**
 * La liste du journal — specs §4.2. « Terminé » est LE geste qui rapporte les
 * points : un tap, date du jour (locale, corrigeable ensuite). Abandon et
 * reprise sont réversibles ; les dates, la note et l'avis s'éditent après coup.
 */

/**
 * La ligne de dates d'une lecture. Depuis #101, les deux bouts peuvent manquer :
 * un « je l'ai déjà lu » de l'étagère d'avant n'a ni début ni fin connus. On
 * dit alors ce qu'on sait, sans inventer de date.
 */
function readingDatesLabel(entry: JournalEntry): string {
  const finished = entry.finishedAt === null ? null : `terminé le ${formatDateFrench(entry.finishedAt)}`;
  if (entry.startedAt === null) return finished === null ? "Date inconnue" : capitalize(finished);
  const started = `Commencé le ${formatDateFrench(entry.startedAt)}`;
  return finished === null ? started : `${started} · ${finished}`;
}

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export type JournalEntry = {
  id: string;
  status: ReadingStatus;
  /** Nullable depuis #101 : une lecture rétroactive n'a pas de début connu. */
  startedAt: string | null;
  finishedAt: string | null;
  rating: number | null;
  comment: string | null;
  book: {
    bookId: string;
    title: string;
    seriesName: string | null;
    issueNumber: string | null;
    category: BookCategory;
    coverUrl: string | null;
    pageCount: number | null;
  };
};

const STATUS_FILTERS = [
  { value: "all", label: "Toutes" },
  { value: "reading", label: "En cours" },
  { value: "finished", label: "Terminées" },
  { value: "abandoned", label: "Abandonnées" },
] as const;

const STATUS_BADGES: Record<
  JournalEntry["status"],
  { label: string; state: ComponentProps<typeof Badge>["state"] }
> = {
  reading: { label: "En cours", state: "reading" },
  finished: { label: "Terminée", state: "done" },
  abandoned: { label: "Abandonnée", state: "abandoned" },
};

/** Les notes permises : de 0,5 à 5, par demi-étoile (specs §4.3). */
const RATING_CHOICES = Array.from({ length: 10 }, (_, index) => (index + 1) / 2);

const SELECT_CLASS =
  "min-w-[9rem] flex-1 rounded-xl border border-line bg-card px-3 py-2 text-sm text-ink " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan";

export function JournalList({
  entries,
  filters,
  sort,
  search,
  totalCount,
  hasMore,
  depth,
  seriesOptions,
  monthOptions,
}: {
  /** La TRANCHE affichée — déjà filtrée et triée par la vue SQL (#32 lot C). */
  entries: JournalEntry[];
  filters: JournalFilters;
  sort: JournalSort;
  /** L'aiguille de recherche COMMITTÉE dans l'URL (#222) — "" = pas de recherche. */
  search: string;
  /** Le total qui matche les filtres (toutes pages confondues). */
  totalCount: number;
  hasMore: boolean;
  depth: number;
  /** Les options des selects — dérivées du journal ENTIER, pas de la tranche. */
  seriesOptions: string[];
  monthOptions: string[];
}) {
  // Un seul Toast pour toute la liste — la célébration de « Terminé ✓ » (#73).
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  /**
   * La correction de catégorie AU JOURNAL (#152) : la catégorie détermine les
   * points de la lecture, et le Journal est l'écran des points — indispensable
   * aux EMPRUNTS, qui n'ont plus de fiche en Biblio (l'inventaire). UN tiroir
   * partagé (celui de la rafale, #101 lot C), recyclé pour toutes les lignes.
   */
  const [editingCategory, setEditingCategory] = useState<{ bookId: string; category: BookCategory } | null>(null);
  const { run, isPending, error, setError } = useBookGestures();

  // Filtres et profondeur vivent dans l'URL (#32 lot C) : changer un filtre
  // NAVIGUE (replace, sans saut de scroll) — le serveur rend la tranche, les
  // gestes continuent de rafraîchir par revalidation, et le bouton retour
  // retombe sur la vue exacte. Un filtre qui change repart en page 1.
  const router = useRouter();
  const [isLoadingPage, startPageTransition] = useTransition();

  /**
   * La recherche (#222) — SERVEUR, car le journal est paginé : une recherche
   * client ne fouillerait que la tranche chargée, en silence. Le champ vit en
   * état local (la frappe reste fluide) et la navigation part DÉBOUNCÉE ; la
   * requête normalise l'aiguille comme la vue SQL (parité lib/search).
   */
  const [searchInput, setSearchInput] = useState(search);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPendingSearch = () => {
    if (searchTimer.current !== null) clearTimeout(searchTimer.current);
    searchTimer.current = null;
  };
  // Resync sur navigation EXTERNE (bouton retour) — sans écraser une frappe en
  // cours : si l'input trim correspond déjà à l'URL, on n'y touche pas.
  // AJUSTEMENT PENDANT LE RENDU (#228, pattern React « adjusting state when
  // props change ») : le setState dans un effet déclenchait un rendu en
  // cascade — ici React re-rend avant de committer, et le lint repasse au
  // vert. L'annulation du timer reste dans un effet (c'est un effet de bord,
  // pas un état) : en attente, il re-committerait l'aiguille par-dessus l'URL
  // restaurée (review #223).
  const [previousSearch, setPreviousSearch] = useState(search);
  if (previousSearch !== search) {
    setPreviousSearch(search);
    if (searchInput.trim() !== search) setSearchInput(search);
  }
  useEffect(() => {
    cancelPendingSearch();
  }, [search]);
  useEffect(() => () => cancelPendingSearch(), []);

  /**
   * TOUTE navigation annule le timer de recherche et emporte la frappe en
   * cours (review #223) : sans ça, changer un filtre pendant les 350 ms du
   * débounce laissait partir le timer APRÈS, avec des filtres périmés dans sa
   * closure — le choix de l'utilisateur était écrasé.
   */
  const navigate = (
    nextFilters: JournalFilters,
    nextDepth: number = JOURNAL_PAGE_SIZE,
    nextSort: JournalSort = sort,
    nextSearch: string = searchInput.trim(),
  ) => {
    cancelPendingSearch();
    const searchString = journalSearchString(nextFilters, nextDepth, nextSort, nextSearch);
    startPageTransition(() => router.replace(`/journal${searchString ? `?${searchString}` : ""}`, { scroll: false }));
  };
  // Filtre ou tri qui change : on repart en page 1 (le tri est conservé à
  // travers les filtres, et réciproquement — la recherche aussi).
  const setFilters = (nextFilters: JournalFilters) => navigate(nextFilters);
  const setSort = (nextSort: JournalSort) => navigate(filters, JOURNAL_PAGE_SIZE, nextSort);
  const onSearchChange = (value: string) => {
    setSearchInput(value);
    cancelPendingSearch();
    if (value.trim() === search) return;
    // Une recherche qui change repart en page 1, comme un filtre.
    searchTimer.current = setTimeout(() => navigate(filters, JOURNAL_PAGE_SIZE, sort, value.trim()), SEARCH_DEBOUNCE_MS);
  };
  /** Le bouton « Réinitialiser » efface filtres ET recherche, d'un coup. */
  const resetAll = () => {
    setSearchInput("");
    navigate(NO_JOURNAL_FILTERS, JOURNAL_PAGE_SIZE, sort, "");
  };

  const hasActiveFilters = hasActiveJournalFilters(filters);
  const hasSearch = search !== "";
  const visible = entries;

  if (totalCount === 0 && !hasActiveFilters && !hasSearch) {
    return (
      <p className="mt-6 text-sm text-ink2">
        Ton journal est vide — scanne ton premier bouquin depuis l&apos;onglet Scanner, et il apparaîtra ici.
      </p>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <FilterChips
        chips={STATUS_FILTERS}
        value={filters.status}
        onChange={(status) => setFilters({ ...filters, status })}
        label="Filtrer par état"
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Rechercher et filtrer">
        {/* La recherche (#222) — même rangée et mêmes classes que la Biblio ;
            flex-WRAP obligatoire (bug #221, vu en prod). */}
        <input
          type="search"
          value={searchInput}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Rechercher un titre ou une série…"
          aria-label="Rechercher dans le journal"
          className="min-w-[12rem] flex-1 rounded-xl border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-ink3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
        />
        <select
          aria-label="Catégorie"
          value={filters.category}
          onChange={(event) => setFilters({ ...filters, category: event.target.value as JournalFilters["category"] })}
          className={SELECT_CLASS}
        >
          <option value="all">Catégorie : toutes</option>
          {ALL_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
        {seriesOptions.length > 0 && (
          <select
            aria-label="Série"
            value={filters.seriesName}
            onChange={(event) => setFilters({ ...filters, seriesName: event.target.value })}
            className={SELECT_CLASS}
          >
            <option value="all">Série : toutes</option>
            {seriesOptions.map((seriesName) => (
              <option key={seriesName} value={seriesName}>
                {seriesName}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Mois"
          value={filters.month}
          onChange={(event) => setFilters({ ...filters, month: event.target.value })}
          className={SELECT_CLASS}
        >
          <option value="all">Mois : tous</option>
          {monthOptions.map((month) => (
            <option key={month} value={month}>
              {formatMonthFrench(month)}
            </option>
          ))}
        </select>
        {/* Le tri (#217) — dans l'URL comme les filtres : la vue SQL ordonne,
            « Charger plus » prolonge, le retour navigateur retombe juste. */}
        <SortSelect value={sort} options={JOURNAL_SORT_OPTIONS} onChange={setSort} className="min-w-[9rem] flex-1" />
      </div>

      {error && <ErrorAlert message={error} />}

      {visible.length === 0 ? (
        <div className="py-6 text-center text-sm text-ink2">
          <p>{hasSearch ? "Aucune lecture ne correspond à la recherche." : "Aucune lecture pour ces filtres."}</p>
          <button type="button" onClick={resetAll} className="mt-2 underline underline-offset-2">
            Réinitialiser
          </button>
        </div>
      ) : (
        <>
          {(hasActiveFilters || hasSearch) && (
            <p className="text-xs text-ink3">
              {totalCount} lecture{totalCount > 1 ? "s" : ""} ·{" "}
              <button type="button" onClick={resetAll} className="underline underline-offset-2">
                réinitialiser
              </button>
            </p>
          )}
          <ul className="flex flex-col gap-3">
            {visible.map((entry, index) => {
              // Le carnet de lecture (#146) : un séparateur quand le mois de
              // fin change — SEULEMENT dans l'ordre Activité (#217) : dans les
              // autres tris, les mois ne sont pas contigus, l'en-tête mentirait.
              // Fragment : JournalItem rend son propre <li>, le séparateur a le sien.
              const separatorMonth =
                sort === DEFAULT_JOURNAL_SORT ? monthSeparatorBefore(visible[index - 1] ?? null, entry) : null;
              return (
                <Fragment key={entry.id}>
                  {separatorMonth !== null && (
                    <li aria-hidden className="mt-2 text-xs font-bold uppercase tracking-wide text-ink3">
                      {separatorMonth === UNDATED_SEPARATOR ? "Plus anciennes — sans date" : formatMonthFrench(separatorMonth)}
                    </li>
                  )}
                  <JournalItem
                    entry={entry}
                    run={run}
                    isPending={isPending}
                    onError={setError}
                    onCelebrate={setToastMessage}
                    onEditCategory={setEditingCategory}
                  />
                </Fragment>
              );
            })}
          </ul>
          {/* « Charger plus » (#32 lot C) : la profondeur grandit dans l'URL —
              le serveur re-rend la liste étendue dans le MÊME ordre (la vue
              fait foi), le scroll ne bouge pas. */}
          {hasMore && (
            <Button
              type="button"
              variant="ghost"
              block
              disabled={isLoadingPage}
              onClick={() => navigate(filters, depth + JOURNAL_PAGE_SIZE, sort)}
            >
              {isLoadingPage
                ? "Chargement…"
                : `Charger plus (${totalCount - visible.length} restante${totalCount - visible.length > 1 ? "s" : ""})`}
            </Button>
          )}
        </>
      )}

      {/* UN tiroir recyclé pour toutes les lignes (#152) — celui de la rafale.
          Le changement revalide /journal : la liste se rafraîchit seule. */}
      <CategoryDrawer
        open={editingCategory !== null}
        bookId={editingCategory?.bookId ?? null}
        value={editingCategory?.category ?? "bd"}
        onClose={() => setEditingCategory(null)}
        onError={setError}
        onChanged={() => setEditingCategory(null)}
      />
      <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </div>
  );
}

function JournalItem({
  entry,
  run,
  isPending,
  onError,
  onCelebrate,
  onEditCategory,
}: {
  entry: JournalEntry;
  run: (action: () => Promise<JournalActionResult>, onSuccess?: () => void) => void;
  isPending: boolean;
  onError: (message: string) => void;
  onCelebrate: (message: string) => void;
  onEditCategory: (target: { bookId: string; category: BookCategory }) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const badge = STATUS_BADGES[entry.status];
  const subtitle = formatBookSubtitle(entry.book.seriesName, entry.book.issueNumber, CATEGORY_LABELS[entry.book.category]);

  return (
    <li className="flex flex-col gap-2.5">
      <BookRow
        title={entry.book.title}
        coverUrl={entry.book.coverUrl}
        bookId={entry.book.bookId}
        placeholderEmoji="📖"
        meta={
          <>
            {subtitle && <div className="truncate">{subtitle}</div>}
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-ink3">
              <span className="tabular-nums">{readingDatesLabel(entry)}</span>
              {entry.rating !== null && <Stars rating={entry.rating} />}
            </div>
          </>
        }
        action={
          <>
            <Badge state={badge.state}>{badge.label}</Badge>
            {entry.status !== "finished" && (
              <Button
                type="button"
                variant="done"
                disabled={isPending}
                onClick={(event) => {
                  // On capte le centre du bouton AU TAP : une fois la lecture
                  // terminée il disparaît, son rect ne vaudrait plus rien.
                  const rect = event.currentTarget.getBoundingClientRect();
                  const origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
                  // N vient du barème réel selon la catégorie — jamais en dur (§3, #73).
                  const points = SCORING_SCALE.pointsByCategory[entry.book.category];
                  run(
                    () => finishReading(entry.id, localToday()),
                    () => {
                      burstConfetti(origin);
                      onCelebrate(`Lecture terminée · ${formatPointsLabel(points)} 🎉`);
                    },
                  );
                }}
              >
                Terminé ✓
              </Button>
            )}
          </>
        }
      />

      <div className="flex items-center gap-2 pl-0.5">
        {entry.status === "reading" && (
          <Button type="button" variant="ghost" disabled={isPending} onClick={() => run(() => abandonReading(entry.id))}>
            Abandonner
          </Button>
        )}
        {entry.status === "abandoned" && (
          <Button type="button" variant="ghost" disabled={isPending} onClick={() => run(() => resumeReading(entry.id))}>
            Reprendre
          </Button>
        )}
        {entry.status === "finished" && (
          <Button type="button" variant="ghost" disabled={isPending} onClick={() => run(() => reopenReading(entry.id))}>
            Repasser en cours
          </Button>
        )}
        {/* La catégorie se corrige ICI (#152) : elle détermine les points de
            cette lecture, et pour un EMPRUNT le Journal est sa seule surface
            (plus de fiche en Biblio — l'inventaire). Même puce qu'en rafale. */}
        <button
          type="button"
          onClick={() => onEditCategory({ bookId: entry.book.bookId, category: entry.book.category })}
          className="ml-auto shrink-0 rounded-full border border-line px-2.5 py-1 text-xs text-ink2"
        >
          {CATEGORY_LABELS[entry.book.category]}
        </button>
        <button
          type="button"
          onClick={() => setIsEditing((value) => !value)}
          className="text-sm text-ink3 underline underline-offset-2"
        >
          {isEditing ? "Fermer" : "Modifier"}
        </button>
      </div>

      {isEditing && (
        <EditPanel entry={entry} run={run} isPending={isPending} onError={onError} onDone={() => setIsEditing(false)} />
      )}
    </li>
  );
}

function EditPanel({
  entry,
  run,
  isPending,
  onError,
  onDone,
}: {
  entry: JournalEntry;
  run: (action: () => Promise<JournalActionResult>) => void;
  isPending: boolean;
  onError: (message: string) => void;
  onDone: () => void;
}) {
  // Vide si la lecture n'a pas de début connu (#101) — l'input date accepte "".
  const [startedAt, setStartedAt] = useState(entry.startedAt ?? "");
  const [finishedAt, setFinishedAt] = useState(entry.finishedAt ?? "");
  const [rating, setRating] = useState(entry.rating === null ? "" : String(entry.rating));
  const [comment, setComment] = useState(entry.comment ?? "");

  const inputClass =
    "rounded-xl border border-line bg-card2 px-3 py-2 text-sm text-ink " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan";

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink2">
          Début
          {/* Pas de date future : on borne la SÉLECTION côté client (le fuseau local, pas UTC). */}
          <input type="date" value={startedAt} max={localToday()} onChange={(event) => setStartedAt(event.target.value)} className={inputClass} />
        </label>
        {entry.status === "finished" && (
          <label className="flex flex-col gap-1 text-xs text-ink2">
            Fin (elle date les points)
            {/* Pas de date future : on borne la SÉLECTION côté client (le fuseau local, pas UTC). */}
            <input type="date" value={finishedAt} max={localToday()} onChange={(event) => setFinishedAt(event.target.value)} className={inputClass} />
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs text-ink2">
          Note
          <select value={rating} onChange={(event) => setRating(event.target.value)} className={inputClass}>
            <option value="">Aucune</option>
            {RATING_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {"★".repeat(Math.floor(choice))}
                {choice % 1 ? "½" : ""} ({String(choice).replace(".", ",")})
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* La photo, filet ultime (§5.4, #47) : proposée quand la cascade n'a
          rien trouvé, ou pour REPRENDRE une photo maison ratée — une
          couverture de source, elle, reste intouchable. */}
      {entry.book.coverUrl === null ? (
        <CoverPhotoButton bookId={entry.book.bookId} />
      ) : (
        isHouseCoverPhotoUrl(entry.book.coverUrl) && <CoverPhotoButton bookId={entry.book.bookId} mode="retake" />
      )}

      <label className="flex flex-col gap-1 text-xs text-ink2">
        Avis — la matière de l&apos;émission
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={2}
          placeholder="« lâché deux fois avant de m'accrocher »…"
          className={`${inputClass} resize-y`}
        />
      </label>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          disabled={isPending}
          onClick={() => {
            // Garde « pas de date future » (le max de l'input ne bloque pas la
            // saisie manuelle) : contre le today LOCAL, avant de soumettre.
            const editedFinishedAt = entry.status === "finished" ? finishedAt || null : entry.finishedAt;
            // Champ vide = date INCONNUE, pas date invalide (#101) : une lecture
            // rétroactive n'a pas de début, et sa note doit rester éditable.
            const editedStartedAt = startedAt || null;
            if (
              (editedStartedAt !== null && editedStartedAt > localToday()) ||
              (editedFinishedAt !== null && editedFinishedAt > localToday())
            ) {
              onError(FUTURE_DATE_MESSAGE);
              return;
            }
            run(() =>
              updateReadingDetails(entry.id, {
                startedAt: editedStartedAt,
                finishedAt: editedFinishedAt,
                rating: rating === "" ? null : Number(rating),
                comment: comment || null,
              }),
            );
            onDone();
          }}
        >
          Enregistrer
        </Button>
        <RemoveButton
          label="Supprimer"
          action={() => softDeleteReading(entry.id)}
          run={run}
          isPending={isPending}
          confirm={() => window.confirm("Retirer cette lecture du journal ? (rien n'est effacé en base)")}
          className="ml-auto"
        />
      </div>
    </Card>
  );
}
