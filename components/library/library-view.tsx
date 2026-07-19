"use client";

import { useMemo, useState, useTransition } from "react";
import { BookCover } from "@/components/book-cover";
import { CoverPhotoButton } from "@/components/cover-photo-button";
import { ErrorAlert } from "@/components/error-alert";
import { CATEGORY_LABELS } from "@/lib/books/categories";
import { isHouseCoverPhotoUrl } from "@/lib/books/cover-photo";
import { NETWORK_ERROR_MESSAGE } from "@/lib/books/errors";
import { formatBookSubtitle } from "@/lib/books/format";
import { startReadingForBook, type JournalActionResult } from "@/lib/books/journal-actions";
import { softDeleteBook } from "@/lib/books/library-actions";
import { localToday } from "@/lib/dates";
import {
  filterLibraryEntries,
  sortLibraryEntries,
  type LibraryEntry,
  type LibrarySortOrder,
  type LibraryStatus,
} from "@/lib/library/derive-library";

/**
 * La vue Bibliothèque (issue #49) — tous les livres, recherche en mémoire
 * (même réserve que les filtres du journal #34 : client tant que pas de
 * pagination #32), et les gestes existants : commencer une lecture, photo de
 * couverture, et « retirer de la bibliothèque » (suppression douce du livre —
 * réversible par rescan, résurrection #10).
 */

const STATUS_BADGES: Record<LibraryStatus, { label: string; className: string }> = {
  reading: { label: "En cours", className: "bg-amber-500/15 text-amber-500" },
  finished: { label: "Lu", className: "bg-green-500/15 text-green-500" },
  "in-pile": { label: "Dans la PAL", className: "bg-blue-500/15 text-blue-400" },
  abandoned: { label: "Abandonné", className: "bg-foreground/10 opacity-70" },
  shelved: { label: "Sans activité", className: "bg-foreground/10 opacity-70" },
};

type LibraryViewProps = {
  entries: LibraryEntry[];
};

export function LibraryView({ entries }: LibraryViewProps) {
  const [searchText, setSearchText] = useState("");
  const [sortOrder, setSortOrder] = useState<LibrarySortOrder>("recent");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const visible = useMemo(
    () => sortLibraryEntries(filterLibraryEntries(entries, searchText), sortOrder),
    [entries, searchText, sortOrder],
  );

  function run(action: () => Promise<JournalActionResult>) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) setError(result.error);
      } catch {
        // Serveur injoignable : la promesse d'une Server Action rejette.
        setError(NETWORK_ERROR_MESSAGE);
      }
    });
  }

  function confirmRemoval(entry: LibraryEntry) {
    const traces = [
      entry.activeReadingCount > 0 ? `${entry.activeReadingCount} lecture(s)` : null,
      entry.activePurchaseCount > 0 ? `${entry.activePurchaseCount} achat(s)` : null,
    ]
      .filter(Boolean)
      .join(" et ");
    const consequence = traces
      ? `Ses ${traces} disparaîtront du journal et du bilan avec lui. `
      : "";
    return window.confirm(
      `Retirer « ${entry.title} » de la bibliothèque ? ${consequence}Rien n'est effacé : le rescanner le fera revenir avec tout son historique.`,
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <p className="text-sm opacity-70">
        {entries.length} livre{entries.length > 1 ? "s" : ""} — tout ce que tu as scanné ou saisi, y compris
        sans lecture ni achat en cours.
      </p>

      <div className="flex gap-2">
        <input
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="Rechercher un titre ou une série…"
          aria-label="Rechercher dans la bibliothèque"
          className="flex-1 rounded-md border border-foreground/20 bg-transparent px-3 py-2.5 text-sm"
        />
        <button
          type="button"
          onClick={() => setSortOrder(sortOrder === "recent" ? "alphabetical" : "recent")}
          className="rounded-md border border-foreground/20 px-3 text-sm"
        >
          {sortOrder === "recent" ? "Récents" : "A → Z"}
        </button>
      </div>

      {error && <ErrorAlert message={error} />}

      {visible.length === 0 ? (
        <p className="py-8 text-center text-sm opacity-70">
          {entries.length === 0 ? "Aucun livre pour l'instant — scanne ton premier bouquin !" : "Aucun livre ne correspond à la recherche."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((entry) => {
            const badge = STATUS_BADGES[entry.status];
            return (
              <li key={entry.bookId} className="rounded-xl border border-foreground/10 p-3">
                <div className="flex gap-3">
                  <BookCover coverUrl={entry.coverUrl} size="small" bookId={entry.bookId} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold">{entry.title}</p>
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}>
                        {badge.label}
                      </span>
                    </div>
                    <p className="text-sm opacity-70">
                      {formatBookSubtitle(entry.seriesName, entry.issueNumber, CATEGORY_LABELS[entry.category])}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      {entry.status !== "reading" && (
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => run(() => startReadingForBook(entry.bookId, localToday()))}
                          className="rounded-full border border-foreground/20 px-3.5 py-1.5 text-sm disabled:opacity-50"
                        >
                          Je commence
                        </button>
                      )}
                      {entry.coverUrl === null && <CoverPhotoButton bookId={entry.bookId} />}
                      {isHouseCoverPhotoUrl(entry.coverUrl) && <CoverPhotoButton bookId={entry.bookId} mode="retake" />}
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => {
                          if (confirmRemoval(entry)) run(() => softDeleteBook(entry.bookId));
                        }}
                        className="ml-auto text-sm text-red-500/80 underline disabled:opacity-50"
                      >
                        Retirer
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
