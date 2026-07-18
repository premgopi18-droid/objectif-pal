"use client";

import { useMemo, useState, useTransition } from "react";
import {
  abandonReading,
  finishReading,
  reopenReading,
  resumeReading,
  softDeleteReading,
  updateReadingDetails,
  type JournalActionResult,
} from "@/lib/books/journal-actions";
import { BookCover } from "@/components/book-cover";
import { ErrorAlert } from "@/components/error-alert";
import { FUTURE_DATE_MESSAGE, NETWORK_ERROR_MESSAGE } from "@/lib/books/errors";
import { ALL_CATEGORIES, CATEGORY_LABELS } from "@/lib/books/categories";
import { formatBookSubtitle } from "@/lib/books/format";
import { formatDateFrench, formatMonthFrench, localToday } from "@/lib/dates";
import type { BookCategory, ReadingStatus } from "@/lib/scoring/types";
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

const STATUS_BADGES: Record<JournalEntry["status"], { label: string; className: string }> = {
  reading: { label: "En cours", className: "bg-amber-500/15 text-amber-500" },
  finished: { label: "Terminée", className: "bg-green-500/15 text-green-500" },
  abandoned: { label: "Abandonnée", className: "bg-foreground/10 opacity-70" },
};

/** Les notes permises : de 0,5 à 5, par demi-étoile (specs §4.3). */
const RATING_CHOICES = Array.from({ length: 10 }, (_, index) => (index + 1) / 2);

export function JournalList({ entries }: { entries: JournalEntry[] }) {
  const [filters, setFilters] = useState<JournalFilters>(NO_JOURNAL_FILTERS);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Les options des selects viennent des entrées elles-mêmes (dérivées en
  // mémoire) ; le filtrage est un Array.filter — aucune requête (§4.2, #34).
  const seriesOptions = useMemo(() => distinctSeriesNames(entries), [entries]);
  const monthOptions = useMemo(() => distinctMonths(entries), [entries]);
  const visible = useMemo(() => filterJournalEntries(entries, filters), [entries, filters]);
  const hasActiveFilters = Object.values(filters).some((value) => value !== "all");

  const selectClass = "min-w-[9rem] flex-1 rounded-md border border-foreground/20 bg-transparent px-2 py-1.5 text-sm";

  const run = (action: () => Promise<JournalActionResult>) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) setError(result.error);
      } catch {
        // Serveur injoignable (réseau coupé) : la promesse de la Server Action
        // rejette — sans ce catch, le geste échouerait en silence.
        setError(NETWORK_ERROR_MESSAGE);
      }
    });
  };

  if (entries.length === 0) {
    return (
      <p className="mt-6 text-sm opacity-70">
        Ton journal est vide — scanne ton premier bouquin depuis l&apos;onglet Scanner, et il apparaîtra ici.
      </p>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer par état">
        {STATUS_FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilters({ ...filters, status: value })}
            aria-pressed={filters.status === value}
            className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
              filters.status === value ? "bg-foreground text-background" : "border border-foreground/20 opacity-70"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer par catégorie, série ou mois">
        <select
          aria-label="Catégorie"
          value={filters.category}
          onChange={(event) => setFilters({ ...filters, category: event.target.value as JournalFilters["category"] })}
          className={selectClass}
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
            className={selectClass}
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
          className={selectClass}
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
        <div className="py-6 text-center text-sm opacity-70">
          <p>Aucune lecture pour ces filtres.</p>
          <button type="button" onClick={() => setFilters(NO_JOURNAL_FILTERS)} className="mt-2 underline">
            Réinitialiser les filtres
          </button>
        </div>
      ) : (
        <>
          {hasActiveFilters && (
            <p className="text-xs opacity-60">
              {visible.length} lecture{visible.length > 1 ? "s" : ""} ·{" "}
              <button type="button" onClick={() => setFilters(NO_JOURNAL_FILTERS)} className="underline">
                réinitialiser
              </button>
            </p>
          )}
          <ul className="flex flex-col gap-3">
            {visible.map((entry) => (
              <JournalItem key={entry.id} entry={entry} run={run} isPending={isPending} onError={setError} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function JournalItem({
  entry,
  run,
  isPending,
  onError,
}: {
  entry: JournalEntry;
  run: (action: () => Promise<JournalActionResult>) => void;
  isPending: boolean;
  onError: (message: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const badge = STATUS_BADGES[entry.status];
  const subtitle = formatBookSubtitle(entry.book.seriesName, entry.book.issueNumber, CATEGORY_LABELS[entry.book.category]);

  return (
    <li className="rounded-xl border border-foreground/10 p-3">
      <div className="flex gap-3">
        <BookCover coverUrl={entry.book.coverUrl} size="small" placeholderEmoji="📖" />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold leading-tight">{entry.book.title}</p>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>{badge.label}</span>
          </div>
          {subtitle && <p className="mt-0.5 truncate text-sm opacity-70">{subtitle}</p>}
          <p className="mt-0.5 text-xs opacity-60">
            Commencé le {formatDateFrench(entry.startedAt)}
            {entry.finishedAt && ` · terminé le ${formatDateFrench(entry.finishedAt)}`}
            {entry.rating !== null && ` · ★ ${String(entry.rating).replace(".", ",")}`}
          </p>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {entry.status !== "finished" && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => finishReading(entry.id, localToday()))}
            className="rounded-full bg-amber-500 px-4 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
          >
            Terminé ✓
          </button>
        )}
        {entry.status === "reading" && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => abandonReading(entry.id))}
            className="rounded-full border border-foreground/20 px-4 py-1.5 text-sm disabled:opacity-50"
          >
            Abandonner
          </button>
        )}
        {entry.status === "abandoned" && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => resumeReading(entry.id))}
            className="rounded-full border border-foreground/20 px-4 py-1.5 text-sm disabled:opacity-50"
          >
            Reprendre
          </button>
        )}
        {entry.status === "finished" && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => reopenReading(entry.id))}
            className="rounded-full border border-foreground/20 px-4 py-1.5 text-sm disabled:opacity-50"
          >
            Repasser en cours
          </button>
        )}
        <button type="button" onClick={() => setIsEditing((value) => !value)} className="ml-auto px-2 py-1.5 text-sm underline opacity-60">
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

  const inputClass = "rounded-md border border-foreground/20 bg-transparent px-2.5 py-1.5 text-sm";

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-foreground/10 pt-3">
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs opacity-80">
          Début
          {/* Pas de date future : on borne la SÉLECTION côté client (le fuseau local, pas UTC). */}
          <input type="date" value={startedAt} max={localToday()} onChange={(event) => setStartedAt(event.target.value)} className={inputClass} />
        </label>
        {entry.status === "finished" && (
          <label className="flex flex-col gap-1 text-xs opacity-80">
            Fin (elle date les points)
            {/* Pas de date future : on borne la SÉLECTION côté client (le fuseau local, pas UTC). */}
            <input type="date" value={finishedAt} max={localToday()} onChange={(event) => setFinishedAt(event.target.value)} className={inputClass} />
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs opacity-80">
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

      <label className="flex flex-col gap-1 text-xs opacity-80">
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
        <button
          type="button"
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
          className="rounded-full bg-foreground px-4 py-1.5 text-sm font-medium text-background disabled:opacity-50"
        >
          Enregistrer
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            if (window.confirm("Retirer cette lecture du journal ? (rien n'est effacé en base)")) {
              run(() => softDeleteReading(entry.id));
            }
          }}
          className="ml-auto text-sm text-red-500/80 underline disabled:opacity-50"
        >
          Supprimer
        </button>
      </div>
    </div>
  );
}
