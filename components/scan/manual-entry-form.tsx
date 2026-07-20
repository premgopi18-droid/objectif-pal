"use client";

import { useMemo, useState } from "react";
import { BookCover } from "@/components/book-cover";
import { CategoryPicker } from "@/components/category-picker";
import { Button } from "@/components/ui/button";
import { ScreenTitle } from "./screen-title";
import { loadLastManualSeries, saveLastManualSeries } from "@/lib/books/last-series";
import { EAN13_LENGTH, isBooklandCode } from "@/lib/resolution/barcode-router";
import type { BookInput } from "@/lib/books/actions";
import type { BookCategory } from "@/lib/scoring/types";

/**
 * La saisie manuelle — le filet ultime de la cascade (specs §5.2) : le scan ne
 * peut pas échouer, il peut juste finir ici. Si un code avait été scanné, on
 * le garde : le livre restera re-résolvable plus tard.
 *
 * Depuis l'issue #55, la chaîne couverture a pu aboutir même quand
 * l'identification a tout raté (les libraires distribuent des livres
 * qu'aucune base ne connaît) : `suggestedCoverUrl` s'affiche alors avec
 * l'explication du pourquoi — l'image sans les infos, c'est déroutant sinon.
 *
 * La série de la dernière saisie est mémorisée (§5.3) : la 2ᵉ issue d'une run
 * se pré-remplit, le curseur part sur le numéro — écrasable librement.
 */

/** Ce que la boîte de finition sait déjà du livre (#101 lot C) — un brouillon, pas un contrat. */
export type ManualEntryInitialValues = {
  title?: string;
  seriesName?: string | null;
  issueNumber?: string | null;
  authors?: string | null;
  publisher?: string | null;
  pageCount?: number | null;
  category?: BookCategory | null;
};

type ManualEntryFormProps = {
  scannedCode: string | null;
  /** La couverture trouvée par la chaîne malgré l'identification ratée (#55). */
  suggestedCoverUrl?: string | null;
  /**
   * Pré-remplissage (#101 lot C) : ce que la cascade avait trouvé de partiel au
   * moment du scan en rafale. Prioritaire sur la mémoire de série — un élément
   * de la boîte sait mieux que le dernier livre saisi.
   */
  initialValues?: ManualEntryInitialValues;
  /** Le libellé du CTA — « Continuer » au scan, autre chose à la finition. */
  submitLabel?: string;
  /** Masque le titre d'écran quand le formulaire est intégré dans une carte. */
  hideHeading?: boolean;
  isSubmitting?: boolean;
  onSubmit: (input: BookInput) => void;
  onCancel: () => void;
};

export function ManualEntryForm({
  scannedCode,
  suggestedCoverUrl = null,
  initialValues,
  submitLabel = "Continuer",
  hideHeading = false,
  isSubmitting = false,
  onSubmit,
  onCancel,
}: ManualEntryFormProps) {
  // Lue UNE fois à l'ouverture (le formulaire ne monte que côté client) : la
  // valeur pré-remplie appartient ensuite à l'utilisateur. Un pré-remplissage
  // explicite l'emporte : il vient de CE livre, pas du précédent.
  const lastSeries = useMemo(() => loadLastManualSeries(), []);
  const [title, setTitle] = useState(initialValues?.title ?? "");
  const [seriesName, setSeriesName] = useState(initialValues?.seriesName ?? lastSeries?.seriesName ?? "");
  const [issueNumber, setIssueNumber] = useState(initialValues?.issueNumber ?? "");
  const [authors, setAuthors] = useState(initialValues?.authors ?? "");
  const [publisher, setPublisher] = useState(initialValues?.publisher ?? "");
  const [pageCount, setPageCount] = useState(initialValues?.pageCount != null ? String(initialValues.pageCount) : "");
  const [category, setCategory] = useState<BookCategory>(
    initialValues?.category ?? lastSeries?.category ?? "bd",
  );

  function submit() {
    // La saisie validée devient la mémoire — ou l'efface si elle est sans série.
    const trimmedSeries = seriesName.trim();
    saveLastManualSeries(trimmedSeries ? { seriesName: trimmedSeries, category } : null);
    onSubmit({
      title,
      seriesName: seriesName.trim() || null,
      issueNumber: issueNumber.trim() || null,
      authors: authors.trim() || null,
      publisher: publisher.trim() || null,
      pageCount: pageCount.trim() ? Number(pageCount) : null,
      coverUrl: suggestedCoverUrl,
      category,
      barcodeRaw: scannedCode,
      barcodeType: scannedCode ? (isBooklandCode(scannedCode) ? "isbn" : "upc") : null,
      isbn: scannedCode && isBooklandCode(scannedCode) ? scannedCode.slice(0, EAN13_LENGTH) : null,
      metadataSource: "manual",
      metadataSourceId: null,
    });
  }

  const inputClass =
    "w-full rounded-xl border border-line bg-card2 px-3 py-2.5 text-ink placeholder:text-ink3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan";

  return (
    <section className="flex flex-col gap-4">
      {!hideHeading && <ScreenTitle>Saisie manuelle</ScreenTitle>}
      {suggestedCoverUrl ? (
        <div className="flex flex-col gap-2 rounded-card border border-line bg-card p-3">
          <div className="flex items-start gap-3">
            <BookCover coverUrl={suggestedCoverUrl} size="large" />
            <p className="text-sm text-ink2">
              On a trouvé la couverture chez les libraires, mais ce livre n&apos;est répertorié dans aucune base
              bibliographique — remplis ses infos (elles sont sous tes yeux !) et il sera nickel dans ta PAL.
            </p>
          </div>
          {/* La promesse §5.2 reste visible : le code est gardé, le livre restera re-résolvable. */}
          {scannedCode && (
            <p className="text-xs text-ink3">
              Code <code className="font-mono">{scannedCode}</code> gardé avec le livre.
            </p>
          )}
        </div>
      ) : (
        scannedCode && (
          <p className="text-sm text-ink2">
            Code scanné mais introuvable : <code className="font-mono">{scannedCode}</code> — il sera gardé avec le livre.
          </p>
        )
      )}

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-ink2">Titre *</span>
        <input autoFocus={lastSeries === null} value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} />
      </label>
      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium text-ink2">Série</span>
          <input value={seriesName} onChange={(event) => setSeriesName(event.target.value)} className={inputClass} />
        </label>
        <label className="flex w-24 flex-col gap-1.5 text-sm">
          <span className="font-medium text-ink2">N°</span>
          {/* Série pré-remplie → le curseur part sur le numéro : « la 2ᵉ issue prend 3 secondes » (§5.3). */}
          <input autoFocus={lastSeries !== null} value={issueNumber} onChange={(event) => setIssueNumber(event.target.value)} className={inputClass} />
        </label>
      </div>
      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium text-ink2">Auteur·ice·s</span>
          <input value={authors} onChange={(event) => setAuthors(event.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium text-ink2">Éditeur</span>
          <input value={publisher} onChange={(event) => setPublisher(event.target.value)} className={inputClass} />
        </label>
      </div>
      <label className="flex w-32 flex-col gap-1.5 text-sm">
        <span className="font-medium text-ink2">Pages</span>
        <input
          type="number"
          min={1}
          value={pageCount}
          onChange={(event) => setPageCount(event.target.value)}
          className={inputClass}
        />
      </label>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink2">Catégorie</legend>
        <CategoryPicker value={category} onChange={setCategory} />
      </fieldset>

      <div className="mt-2 flex gap-3">
        <Button
          type="button"
          variant="grad"
          block
          disabled={!title.trim() || isSubmitting}
          onClick={submit}
          className="flex-1"
        >
          {submitLabel}
        </Button>
        <button type="button" onClick={onCancel} disabled={isSubmitting} className="px-4 text-sm text-ink3 disabled:opacity-50">
          Annuler
        </button>
      </div>
    </section>
  );
}
