"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { BookRow } from "@/components/ui/book-row";
import { Button } from "@/components/ui/button";
import { CoverPhotoButton } from "@/components/cover-photo-button";
import { ErrorAlert } from "@/components/error-alert";
import { RemoveButton, StartReadingButton, useBookGestures } from "@/components/library/book-gestures";
import { endOwnership } from "@/lib/books/actions";
import { CATEGORY_LABELS } from "@/lib/books/categories";
import { isHouseCoverPhotoUrl } from "@/lib/books/cover-photo";
import { formatBookSubtitle } from "@/lib/books/format";
import { softDeleteBook } from "@/lib/books/library-actions";
import { localToday } from "@/lib/dates";
import {
  filterLibraryEntries,
  sortLibraryEntries,
  type LibraryEntry,
  type LibrarySortOrder,
  type LibraryStatus,
} from "@/lib/library/derive-library";
import type { ComponentProps } from "react";

/**
 * La vue Bibliothèque (issue #49) — tous les livres, recherche en mémoire
 * (même réserve que les filtres du journal #34 : client tant que pas de
 * pagination #32), et les gestes existants : commencer une lecture, photo de
 * couverture, et « retirer de la bibliothèque » (suppression douce du livre —
 * réversible par rescan, résurrection #10). Gestes « Je commence » / retrait /
 * photo mutualisés (design-specs §3).
 */

/**
 * Le badge d'état — priorités §4.12 : En cours > Lu > Dans la PAL > Abandonné >
 * Sans activité. Chaque état pointe sur une variante du `Badge` (#66) : cyan,
 * vert, magenta, muet, ambre — dans le même ordre.
 */
const STATUS_BADGES: Record<LibraryStatus, { label: string; state: ComponentProps<typeof Badge>["state"] }> = {
  reading: { label: "En cours", state: "reading" },
  finished: { label: "Lu", state: "done" },
  "in-pile": { label: "Dans la PAL", state: "pile" },
  abandoned: { label: "Abandonné", state: "abandoned" },
  // #101 : donné, revendu, perdu — un état à part de « sans activité », qui
  // dirait faussement que le livre n'a jamais rien vécu ici.
  disposed: { label: "Plus possédé", state: "idle" },
  shelved: { label: "Sans activité", state: "idle" },
};

type LibraryViewProps = {
  entries: LibraryEntry[];
};

export function LibraryView({ entries }: LibraryViewProps) {
  const [searchText, setSearchText] = useState("");
  const [sortOrder, setSortOrder] = useState<LibrarySortOrder>("recent");
  const { run, isPending, error } = useBookGestures();

  const visible = useMemo(
    () => sortLibraryEntries(filterLibraryEntries(entries, searchText), sortOrder),
    [entries, searchText, sortOrder],
  );

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

  /**
   * La confirmation dit exactement ce que « je ne le possède plus » NE fait
   * pas — c'est là toute la différence avec « Retirer » juste à côté, et la
   * confondre coûterait des points au bilan (#101).
   */
  function confirmDisposal(entry: LibraryEntry) {
    return window.confirm(
      `Tu ne possèdes plus « ${entry.title} » ? Il sortira de ta bibliothèque et de ta PAL, mais ses lectures et ses points restent au journal et au bilan.`,
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <p className="text-sm text-ink2">
        {entries.length} livre{entries.length > 1 ? "s" : ""} — tout ce que tu as scanné ou saisi, y compris
        sans lecture ni achat en cours.
      </p>

      <div className="flex gap-2">
        <input
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="Rechercher un titre ou une série…"
          aria-label="Rechercher dans la bibliothèque"
          className="flex-1 rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink placeholder:text-ink3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
        />
        <Button
          type="button"
          variant="ghost"
          aria-label="Changer le tri"
          onClick={() => setSortOrder(sortOrder === "recent" ? "alphabetical" : "recent")}
        >
          {sortOrder === "recent" ? "Récents" : "A → Z"}
        </Button>
      </div>

      {error && <ErrorAlert message={error} />}

      {visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink2">
          {entries.length === 0 ? "Aucun livre pour l'instant — scanne ton premier bouquin !" : "Aucun livre ne correspond à la recherche."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((entry) => {
            const badge = STATUS_BADGES[entry.status];
            const needsPhoto = entry.coverUrl === null;
            const canRetakePhoto = isHouseCoverPhotoUrl(entry.coverUrl);
            return (
              <li key={entry.bookId} className="flex flex-col gap-2.5">
                <BookRow
                  title={entry.title}
                  coverUrl={entry.coverUrl}
                  bookId={entry.bookId}
                  meta={formatBookSubtitle(entry.seriesName, entry.issueNumber, CATEGORY_LABELS[entry.category])}
                  action={<Badge state={badge.state}>{badge.label}</Badge>}
                />

                {/* La photo, filet ultime (§5.4) : proposée quand aucune couverture,
                    ou pour reprendre une photo maison. Geste déjà mutualisé (#66). */}
                {needsPhoto ? (
                  <CoverPhotoButton bookId={entry.bookId} />
                ) : (
                  canRetakePhoto && <CoverPhotoButton bookId={entry.bookId} mode="retake" />
                )}

                <div className="flex items-center gap-3 pl-0.5">
                  {entry.status !== "reading" && (
                    <StartReadingButton bookId={entry.bookId} run={run} isPending={isPending} />
                  )}
                  {/* « Je ne le possède plus » (#101) — le livre quitte l'étagère,
                      mais ses lectures et ses points RESTENT au bilan. À ne pas
                      confondre avec « Retirer », juste à côté, qui masque tout. */}
                  {entry.isOwned && (
                    <RemoveButton
                      label="Je ne le possède plus"
                      action={() => endOwnership(entry.bookId, localToday())}
                      run={run}
                      isPending={isPending}
                      confirm={() => confirmDisposal(entry)}
                      tone="muted"
                      className="text-xs"
                    />
                  )}
                  <RemoveButton
                    label="Retirer"
                    action={() => softDeleteBook(entry.bookId)}
                    run={run}
                    isPending={isPending}
                    confirm={() => confirmRemoval(entry)}
                    className="ml-auto"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
