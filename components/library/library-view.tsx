"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { BookRow } from "@/components/ui/book-row";
import { Button } from "@/components/ui/button";
import { Toast } from "@/components/ui/toast";
import { CoverPhotoButton } from "@/components/cover-photo-button";
import { ErrorAlert } from "@/components/error-alert";
import { BookEditForm } from "@/components/library/book-edit-form";
import { BookMergePicker } from "@/components/library/book-merge-picker";
import { FinishReadingButton, RemoveButton, StartReadingButton, useBookGestures } from "@/components/library/book-gestures";
import { endOwnership } from "@/lib/books/actions";
import { CATEGORY_LABELS } from "@/lib/books/categories";
import { isHouseCoverPhotoUrl } from "@/lib/books/cover-photo";
import { NETWORK_ERROR_MESSAGE } from "@/lib/books/errors";
import { formatBookSubtitle } from "@/lib/books/format";
import { applyCategoryToSeries, softDeleteBook } from "@/lib/books/library-actions";
import {
  seriesAlignSheetCopy,
  seriesAlignedToastMessage,
  type SeriesAlignProposal,
} from "@/lib/books/series-align";
import { localToday } from "@/lib/dates";
import {
  filterLibraryEntries,
  sortLibraryEntries,
  type LibraryEntry,
  type LibrarySortOrder,
  type LibraryStatus,
} from "@/lib/library/derive-library";
import { SortSelect } from "@/components/ui/sort-select";
import { ENTRY_SORT_LABELS } from "@/lib/sort/entry-sort";
import type { ComponentProps } from "react";

/** Les tris de l'inventaire (#217) — « Activité récente » = l'ancien « Récents » (#146). */
const LIBRARY_SORT_OPTIONS = (["ajout", "ajout-ancien", "activite", "titre", "titre-inverse"] as const).map(
  (value) => ({ value, label: ENTRY_SORT_LABELS[value] }),
);

/**
 * La vue Bibliothèque (issue #49, #152) — l'INVENTAIRE du possédé, recherche en
 * mémoire (même réserve que les filtres du journal #34 : client tant que pas
 * de pagination #32), et les gestes : commencer une lecture, photo de
 * couverture, éditer/fusionner (#100), et « Retirer de ma bibliothèque »
 * (#114) — LE geste de sortie unique, qui ne touche jamais ni lectures ni
 * points. Gestes « Je commence » / retrait / photo mutualisés (design-specs §3).
 */

/**
 * Le badge d'état — priorités §4.12 : En cours > Lu > Dans la PAL. Trois états
 * seulement depuis l'inventaire (#152) : un possédé jamais fini est à lire.
 */
const STATUS_BADGES: Record<LibraryStatus, { label: string; state: ComponentProps<typeof Badge>["state"] }> = {
  reading: { label: "En cours", state: "reading" },
  finished: { label: "Lu", state: "done" },
  "in-pile": { label: "Dans la PAL", state: "pile" },
};

type LibraryViewProps = {
  entries: LibraryEntry[];
};

export function LibraryView({ entries }: LibraryViewProps) {
  const [searchText, setSearchText] = useState("");
  // « Ajout récent » par défaut (#217) : le dernier scan en haut.
  const [sortOrder, setSortOrder] = useState<LibrarySortOrder>("ajout");
  const { run, isPending, error } = useBookGestures();
  /** La fiche ouverte en édition — une seule à la fois (#100). */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  /** Le livre CONSERVÉ d'une fusion en cours (#100) — un seul à la fois. */
  const [mergingId, setMergingId] = useState<string | null>(null);
  /** La proposition d'alignement de série (#257), rendue par l'enregistrement. */
  const [alignProposal, setAlignProposal] = useState<SeriesAlignProposal | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isAligning, startAlignTransition] = useTransition();
  // Mémoïsé (leçon review #259) : l'effet de la feuille en dépend.
  const closeAlignSheet = useCallback(() => setAlignProposal(null), []);

  function confirmSeriesAlign(proposal: SeriesAlignProposal) {
    setEditError(null);
    startAlignTransition(async () => {
      try {
        const result = await applyCategoryToSeries(proposal.seriesName, proposal.category);
        if (!result.ok) {
          setEditError(result.error);
          return;
        }
        // Le toast annonce le compte RÉEL de l'UPDATE, jamais celui de la
        // proposition — entre la feuille et le tap, un autre onglet a pu bouger.
        setToastMessage(seriesAlignedToastMessage(result.updated, CATEGORY_LABELS[proposal.category]));
      } catch {
        // Serveur injoignable : la promesse de la Server Action rejette.
        setEditError(NETWORK_ERROR_MESSAGE);
      } finally {
        setAlignProposal(null);
      }
    });
  }

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
        {entries.length} livre{entries.length > 1 ? "s" : ""} — l&apos;inventaire de ce que tu possèdes.
        Les emprunts lus vivent au Journal.
      </p>

      {/* flex-WRAP obligatoire (bug du 15/08, vu en prod) : un <select> a une
          largeur incompressible (sa plus longue option) — avec shrink-0 sur un
          rang non-wrappant, la rangée débordait du viewport et toute la page
          partait en scroll horizontal (nav comprise). Même patron que la
          rangée de filtres du Journal. */}
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="Rechercher un titre ou une série…"
          aria-label="Rechercher dans la bibliothèque"
          className="min-w-[12rem] flex-1 rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink placeholder:text-ink3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
        />
        {/* Le sélecteur commun (#217) — « Ajout récent » par défaut, et
            « Activité récente » préserve l'ancien « Récents » (#146). */}
        <SortSelect value={sortOrder} options={LIBRARY_SORT_OPTIONS} onChange={setSortOrder} className="min-w-[9rem] flex-1" />
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
            // Un SEUL appel (review #116) : action et confirmation viennent de
            // la même décision — pas deux calculs qui pourraient diverger.
            const removal = removeFromLibrary(entry);
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
                    onSeriesAlign={setAlignProposal}
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
                  {entry.status !== "reading" ? (
                    <StartReadingButton bookId={entry.bookId} run={run} isPending={isPending} />
                  ) : (
                    // « Terminé ✓ » là où le livre est visible (#144).
                    <FinishReadingButton bookId={entry.bookId} run={run} isPending={isPending} />
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
                    action={removal.action}
                    run={run}
                    isPending={isPending}
                    confirm={removal.confirmed}
                    tone="muted"
                    className="ml-auto"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {alignProposal !== null && (
        <SeriesAlignSheet
          proposal={alignProposal}
          isPending={isAligning}
          onCancel={closeAlignSheet}
          onConfirm={() => confirmSeriesAlign(alignProposal)}
        />
      )}

      <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </div>
  );
}

/**
 * La feuille d'alignement de série (#257, maquette validée le 31/08) — patron
 * maison (finished-covers/#256) : dialog, fond cliquable, Échap, animations
 * sous le kill-switch prefers-reduced-motion. Le lot est IMPLICITE : pas de
 * cases, la série est la sélection. Refuser = la fiche seule (un hors-série
 * peut légitimement différer).
 */
function SeriesAlignSheet({
  proposal,
  isPending,
  onCancel,
  onConfirm,
}: {
  proposal: SeriesAlignProposal;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ctaRef = useRef<HTMLButtonElement>(null);
  const copy = seriesAlignSheetCopy(proposal, CATEGORY_LABELS[proposal.category]);

  // Échap ferme ; le focus part sur le CTA à l'ouverture (dialog).
  useEffect(() => {
    ctaRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
      className="animate-[fade-in_240ms_ease] fixed inset-0 z-50 flex items-end bg-black/60"
      onClick={onCancel}
    >
      <div
        className="animate-[sheet-in_280ms_cubic-bezier(0.32,0.72,0.24,1)] w-full rounded-t-2xl border-t border-line bg-card p-4 pb-8"
        onClick={(event) => event.stopPropagation()}
      >
        <div aria-hidden className="mx-auto h-1 w-10 rounded-full bg-line" />
        <h2 className="mt-3 text-base font-black text-ink">{copy.title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink2">{copy.body}</p>
        <div className="mt-4 flex flex-col gap-3">
          <Button ref={ctaRef} type="button" variant="grad" block disabled={isPending} onClick={onConfirm}>
            {copy.cta}
          </Button>
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="py-2 text-sm text-ink3 disabled:opacity-50"
          >
            Cette fiche seulement
          </button>
        </div>
      </div>
    </div>
  );
}
