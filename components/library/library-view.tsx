"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { BookRow } from "@/components/ui/book-row";
import { Button } from "@/components/ui/button";
import { CoverPhotoButton } from "@/components/cover-photo-button";
import { ErrorAlert } from "@/components/error-alert";
import { BookEditForm } from "@/components/library/book-edit-form";
import { BookMergePicker } from "@/components/library/book-merge-picker";
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
  shelved: { label: "Sans activité", state: "idle" },
};

type LibraryViewProps = {
  entries: LibraryEntry[];
};

export function LibraryView({ entries }: LibraryViewProps) {
  const [searchText, setSearchText] = useState("");
  const [sortOrder, setSortOrder] = useState<LibrarySortOrder>("recent");
  const { run, isPending, error } = useBookGestures();
  /** La fiche ouverte en édition — une seule à la fois (#100). */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  /** Le livre CONSERVÉ d'une fusion en cours (#100) — un seul à la fois. */
  const [mergingId, setMergingId] = useState<string | null>(null);

  const visible = useMemo(
    () => sortLibraryEntries(filterLibraryEntries(entries, searchText), sortOrder),
    [entries, searchText, sortOrder],
  );

  /**
   * UN seul geste de sortie (#114) : « Retirer de ma bibliothèque » = ne plus
   * posséder — jamais de conséquence sur les lectures ni les points. La
   * mécanique s'adapte toute seule :
   *
   *  - le livre a des traces actives → cession datée (`endOwnership`) : tout
   *    reste au journal, au bilan et aux stats, seul le livre quitte la liste ;
   *  - AUCUNE trace → rien à préserver, c'est le livre-erreur : suppression
   *    douce (`softDeleteBook`), sans fabriquer de fausse possession ni polluer
   *    les flux du mois — et rescanner le fait revenir (résurrection #10).
   *
   * Une lecture erronée se corrige AVANT, au journal (« Supprimer » par
   * lecture) : plus aucun geste de la Biblio ne peut avaler des stats.
   */
  function removeFromLibrary(entry: LibraryEntry) {
    const hasTraces = entry.activeReadingCount > 0 || entry.activePurchaseCount > 0;
    if (!hasTraces) {
      return {
        confirmed: () =>
          window.confirm(
            `Retirer « ${entry.title} » de ta bibliothèque ? Il n'a ni lecture ni achat — il disparaîtra, et le rescanner le fera revenir.`,
          ),
        action: () => softDeleteBook(entry.bookId),
      };
    }
    // Garde-fou achat (#114) : la cession ne touche jamais un achat — s'il
    // était une erreur, son malus resterait compté. On le dit AVANT, tant que
    // le livre est encore dans la Pile où vit « Je ne l'ai pas acheté ».
    const purchaseWarning =
      entry.activePurchaseCount > 0
        ? " Si un achat était une erreur, annule-le d'abord depuis la Pile (« Je ne l'ai pas acheté »)."
        : "";
    return {
      confirmed: () =>
        window.confirm(
          `Retirer « ${entry.title} » de ta bibliothèque ? Ses lectures et ses points restent au journal et au bilan.${purchaseWarning}`,
        ),
      action: () => endOwnership(entry.bookId, localToday()),
    };
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
      {editError && <ErrorAlert message={editError} />}

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

                {/* L'édition de fiche (#100) — ouverte sur place, une seule à la
                    fois : deux formulaires ouverts inviteraient à en abandonner un. */}
                {editingId === entry.bookId && (
                  <BookEditForm
                    entry={entry}
                    onDone={() => setEditingId(null)}
                    onError={(message) => {
                      setEditError(message);
                      setEditingId(null);
                    }}
                  />
                )}

                {/* La fusion de doublons (#100) — le livre ouvert est celui
                    qu'on CONSERVE, on choisit celui qui vient s'y fondre. */}
                {mergingId === entry.bookId && (
                  <BookMergePicker
                    keep={entry}
                    entries={entries}
                    onDone={() => setMergingId(null)}
                    onError={(message) => {
                      setEditError(message);
                      setMergingId(null);
                    }}
                  />
                )}

                {/* `flex-wrap` (#114) : la rangée passe à la ligne sur petit
                    écran au lieu de s'écraser. */}
                <div className="flex flex-wrap items-center gap-3 pl-0.5">
                  {entry.status !== "reading" && (
                    <StartReadingButton bookId={entry.bookId} run={run} isPending={isPending} />
                  )}
                  <button
                    type="button"
                    aria-expanded={editingId === entry.bookId}
                    aria-controls={`edit-${entry.bookId}`}
                    onClick={() => setEditingId(editingId === entry.bookId ? null : entry.bookId)}
                    className="text-sm text-ink2 underline underline-offset-2"
                  >
                    {editingId === entry.bookId ? "Fermer" : "Modifier"}
                  </button>
                  <button
                    type="button"
                    aria-expanded={mergingId === entry.bookId}
                    aria-controls={`merge-${entry.bookId}`}
                    onClick={() => setMergingId(mergingId === entry.bookId ? null : entry.bookId)}
                    className="text-sm text-ink2 underline underline-offset-2"
                  >
                    {mergingId === entry.bookId ? "Fermer" : "Fusionner"}
                  </button>
                  {/* LE geste de sortie, unique (#114) : retirer = ne plus
                      posséder, lectures et points toujours conservés. La
                      mécanique du livre-erreur (aucune trace) est choisie en
                      interne — plus aucun bouton ne peut avaler des stats. */}
                  <RemoveButton
                    label="Retirer de ma bibliothèque"
                    action={removeFromLibrary(entry).action}
                    run={run}
                    isPending={isPending}
                    confirm={removeFromLibrary(entry).confirmed}
                    tone="muted"
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
