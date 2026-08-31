"use client";

import { useState, useTransition } from "react";
import { CategoryPicker } from "@/components/category-picker";
import { Button } from "@/components/ui/button";
import { updateBookDetails } from "@/lib/books/library-actions";
import { NETWORK_ERROR_MESSAGE } from "@/lib/books/errors";
import type { SeriesAlignProposal } from "@/lib/books/series-align";
import type { LibraryEntry } from "@/lib/library/derive-library";
import type { BookCategory } from "@/lib/scoring/types";

/**
 * Le formulaire d'édition de fiche (issue #100).
 *
 * Il existe pour un cas que le rescan ne couvre pas : un livre **saisi à la
 * main n'a pas de code-barres**, donc rien à rescanner — sa fiche restait
 * fausse pour toujours (§4.12). Et la **catégorie** doit être corrigeable
 * partout, parce qu'elle détermine les points (§3).
 *
 * Les champs code-barres et source ne sont **pas** ici, volontairement : c'est
 * le pont de re-résolution (§7). La validation est celle de `prepareBookEdit`,
 * rejouée côté serveur — le formulaire n'est pas la garde.
 */
const INPUT_CLASS =
  "w-full rounded-xl border border-line bg-card2 px-3 py-2.5 text-ink placeholder:text-ink3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan";

export function BookEditForm({
  entry,
  onDone,
  onError,
  onSeriesAlign,
}: {
  entry: LibraryEntry;
  onDone: () => void;
  onError: (message: string) => void;
  /**
   * La fiche sauvée appartient à une série dont d'autres tomes divergent
   * (#257) : le parent ouvre la feuille de proposition — le compte vient du
   * serveur, pas de la liste affichée.
   */
  onSeriesAlign: (proposal: SeriesAlignProposal) => void;
}) {
  const [title, setTitle] = useState(entry.title);
  const [seriesName, setSeriesName] = useState(entry.seriesName ?? "");
  const [issueNumber, setIssueNumber] = useState(entry.issueNumber ?? "");
  const [authors, setAuthors] = useState(entry.authors ?? "");
  const [publisher, setPublisher] = useState(entry.publisher ?? "");
  const [pageCount, setPageCount] = useState(entry.pageCount === null ? "" : String(entry.pageCount));
  const [category, setCategory] = useState<BookCategory>(entry.category);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      try {
        const result = await updateBookDetails(entry.bookId, {
          title,
          seriesName,
          issueNumber,
          authors,
          publisher,
          pageCount,
          category,
        });
        if (!result.ok) {
          onError(result.error);
          return;
        }
        onDone();
        // La proposition ne part que si la catégorie a CHANGÉ (review #261,
        // décision 1 du ticket) : une série volontairement mixte (hors-série
        // gardé tel quel) ne doit pas la rouvrir à chaque édition des pages —
        // le nagging apprendrait à ignorer une feuille qui touche aux points.
        if (result.seriesAlign !== null && category !== entry.category) onSeriesAlign(result.seriesAlign);
      } catch {
        // Serveur injoignable : la promesse de la Server Action rejette.
        onError(NETWORK_ERROR_MESSAGE);
      }
    });
  };

  return (
    <div id={`edit-${entry.bookId}`} className="flex flex-col gap-3 rounded-card border border-line bg-card2 p-3">
      {!entry.hasBarcode && (
        <p className="text-xs text-ink3">
          Ce livre n&apos;a pas de code-barres : l&apos;édition est le seul moyen de corriger sa fiche.
        </p>
      )}

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-ink2">Titre *</span>
        {/* Le focus part sur le premier champ à l'ouverture (même geste que
            `manual-entry-form`) : au clavier, « Modifier » doit mener quelque
            part — le formulaire est rendu AVANT le bouton dans le DOM. */}
        <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} className={INPUT_CLASS} />
      </label>

      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium text-ink2">Série</span>
          <input value={seriesName} onChange={(event) => setSeriesName(event.target.value)} className={INPUT_CLASS} />
        </label>
        <label className="flex w-24 flex-col gap-1.5 text-sm">
          <span className="font-medium text-ink2">N°</span>
          <input value={issueNumber} onChange={(event) => setIssueNumber(event.target.value)} className={INPUT_CLASS} />
        </label>
      </div>

      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium text-ink2">Auteur·ice·s</span>
          <input value={authors} onChange={(event) => setAuthors(event.target.value)} className={INPUT_CLASS} />
        </label>
        <label className="flex flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium text-ink2">Éditeur</span>
          <input value={publisher} onChange={(event) => setPublisher(event.target.value)} className={INPUT_CLASS} />
        </label>
      </div>

      <label className="flex w-32 flex-col gap-1.5 text-sm">
        <span className="font-medium text-ink2">Pages</span>
        <input
          type="number"
          min={1}
          value={pageCount}
          onChange={(event) => setPageCount(event.target.value)}
          className={INPUT_CLASS}
        />
      </label>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink2">Catégorie</legend>
        <CategoryPicker value={category} onChange={setCategory} />
        {/* Dit à voix haute ce que la correction implique : le score est
            dérivé (§7), donc les bilans passés bougent. C'est voulu. */}
        {category !== entry.category && (
          <p className="mt-2 text-xs text-amber">
            La catégorie change les points : les bilans des mois où ce livre a été lu seront recalculés.
          </p>
        )}
      </fieldset>

      <div className="mt-1 flex items-center gap-3">
        <Button type="button" variant="grad" disabled={!title.trim() || isPending} onClick={submit}>
          Enregistrer
        </Button>
        <button
          type="button"
          onClick={onDone}
          disabled={isPending}
          className="px-2 text-sm text-ink3 disabled:opacity-50"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}
