"use client";

import { useMemo, useState, useTransition } from "react";
import { BookCover } from "@/components/book-cover";
import { mergeBooks } from "@/lib/books/library-actions";
import { NETWORK_ERROR_MESSAGE } from "@/lib/books/errors";
import { describeMergeConsequence, findMergeCandidates } from "@/lib/books/book-duplicates";
import { formatBookSubtitle } from "@/lib/books/format";
import { CATEGORY_LABELS } from "@/lib/books/categories";
import type { LibraryEntry } from "@/lib/library/derive-library";

/**
 * Le choix du doublon à fusionner (issue #100).
 *
 * Le livre ouvert est celui qu'on **conserve** ; on choisit celui qui vient s'y
 * fondre. La liste ne propose que des paires réellement fusionnables (deux
 * codes-barres différents = deux éditions, refusé) — lister des livres qu'on
 * refusera ensuite ferait cliquer pour rien.
 */
export function BookMergePicker({
  keep,
  entries,
  onDone,
  onError,
}: {
  keep: LibraryEntry;
  entries: LibraryEntry[];
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [searchText, setSearchText] = useState("");
  const [isPending, startTransition] = useTransition();

  const candidates = useMemo(
    () => findMergeCandidates(keep, entries, searchText),
    [keep, entries, searchText],
  );

  const merge = (candidate: LibraryEntry) => {
    if (!window.confirm(describeMergeConsequence(keep, candidate))) return;
    startTransition(async () => {
      try {
        const result = await mergeBooks(keep.bookId, candidate.bookId);
        if (!result.ok) {
          onError(result.error);
          return;
        }
        onDone();
      } catch {
        // Serveur injoignable : la promesse de la Server Action rejette.
        onError(NETWORK_ERROR_MESSAGE);
      }
    });
  };

  return (
    <div id={`merge-${keep.bookId}`} className="flex flex-col gap-3 rounded-card border border-line bg-card2 p-3">
      <div>
        <p className="text-sm font-medium text-ink2">Fusionner un doublon dans « {keep.title} »</p>
        <p className="mt-0.5 text-xs text-ink3">
          Le livre choisi disparaîtra ; ses lectures et ses achats seront rattachés à celui-ci.
        </p>
      </div>

      <input
        type="search"
        value={searchText}
        onChange={(event) => setSearchText(event.target.value)}
        placeholder="Chercher le doublon…"
        aria-label="Chercher le doublon"
        className="w-full rounded-xl border border-line bg-card px-3 py-2.5 text-ink placeholder:text-ink3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
      />

      {candidates.length === 0 ? (
        <p className="text-sm text-ink3">
          {entries.length <= 1
            ? "Il n'y a pas d'autre livre à fusionner."
            : "Aucun livre fusionnable ne correspond — un livre qui a déjà son propre code-barres ne peut pas être un doublon de celui-ci."}
        </p>
      ) : (
        <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          {candidates.map((candidate) => (
            <li key={candidate.bookId}>
              <button
                type="button"
                disabled={isPending}
                onClick={() => merge(candidate)}
                className="flex w-full items-center gap-3 rounded-xl border border-line bg-card px-3 py-2 text-left disabled:opacity-50"
              >
                <BookCover coverUrl={candidate.coverUrl} size="small" title={candidate.title} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{candidate.title}</span>
                  <span className="block truncate text-xs text-ink3">
                    {formatBookSubtitle(
                      candidate.seriesName,
                      candidate.issueNumber,
                      CATEGORY_LABELS[candidate.category],
                    )}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" onClick={onDone} disabled={isPending} className="self-start px-2 text-sm text-ink3 disabled:opacity-50">
        Annuler
      </button>
    </div>
  );
}
