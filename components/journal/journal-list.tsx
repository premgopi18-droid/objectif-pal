"use client";

import { useMemo, useState } from "react";
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
import {
  distinctMonths,
  distinctSeriesNames,
  filterJournalEntries,
  NO_JOURNAL_FILTERS,
  type JournalFilters,
} from "./filter-journal-entries";

/**
 * La liste du journal — specs §4.2. « Terminé » est LE geste qui rapporte les
 * points : un tap, date du jour (locale, corrigeable ensuite). Abandon et
 * reprise sont réversibles ; les dates, la note et l'avis s'éditent après coup.
 */

export type JournalEntry = {
  id: string;
  status: ReadingStatus;
  startedAt: string;
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

export function JournalList({ entries }: { entries: JournalEntry[] }) {
  const [filters, setFilters] = useState<JournalFilters>(NO_JOURNAL_FILTERS);
  // Un seul Toast pour toute la liste — la célébration de « Terminé ✓ » (#73).
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const { run, isPending, error, setError } = useBookGestures();

  // Les options des selects viennent des entrées elles-mêmes (dérivées en
  // mémoire) ; le filtrage est un Array.filter — aucune requête (§4.2, #34).
  const seriesOptions = useMemo(() => distinctSeriesNames(entries), [entries]);
  const monthOptions = useMemo(() => distinctMonths(entries), [entries]);
  const visible = useMemo(() => filterJournalEntries(entries, filters), [entries, filters]);
  const hasActiveFilters = Object.values(filters).some((value) => value !== "all");

  if (entries.length === 0) {
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

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer par catégorie, série ou mois">
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
      </div>

      {error && <ErrorAlert message={error} />}

      {visible.length === 0 ? (
        <div className="py-6 text-center text-sm text-ink2">
          <p>Aucune lecture pour ces filtres.</p>
          <button
            type="button"
            onClick={() => setFilters(NO_JOURNAL_FILTERS)}
            className="mt-2 underline underline-offset-2"
          >
            Réinitialiser les filtres
          </button>
        </div>
      ) : (
        <>
          {hasActiveFilters && (
            <p className="text-xs text-ink3">
              {visible.length} lecture{visible.length > 1 ? "s" : ""} ·{" "}
              <button
                type="button"
                onClick={() => setFilters(NO_JOURNAL_FILTERS)}
                className="underline underline-offset-2"
              >
                réinitialiser
              </button>
            </p>
          )}
          <ul className="flex flex-col gap-3">
            {visible.map((entry) => (
              <JournalItem
                key={entry.id}
                entry={entry}
                run={run}
                isPending={isPending}
                onError={setError}
                onCelebrate={setToastMessage}
              />
            ))}
          </ul>
        </>
      )}

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
}: {
  entry: JournalEntry;
  run: (action: () => Promise<JournalActionResult>, onSuccess?: () => void) => void;
  isPending: boolean;
  onError: (message: string) => void;
  onCelebrate: (message: string) => void;
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
              <span className="tabular-nums">
                Commencé le {formatDateFrench(entry.startedAt)}
                {entry.finishedAt && ` · terminé le ${formatDateFrench(entry.finishedAt)}`}
              </span>
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
        <button
          type="button"
          onClick={() => setIsEditing((value) => !value)}
          className="ml-auto text-sm text-ink3 underline underline-offset-2"
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
  const [startedAt, setStartedAt] = useState(entry.startedAt);
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
            if (startedAt > localToday() || (editedFinishedAt !== null && editedFinishedAt > localToday())) {
              onError(FUTURE_DATE_MESSAGE);
              return;
            }
            run(() =>
              updateReadingDetails(entry.id, {
                startedAt,
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
