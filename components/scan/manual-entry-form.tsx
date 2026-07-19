"use client";

import { useMemo, useState } from "react";
import { BookCover } from "@/components/book-cover";
import { CategoryPicker } from "@/components/category-picker";
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

type ManualEntryFormProps = {
  scannedCode: string | null;
  /** La couverture trouvée par la chaîne malgré l'identification ratée (#55). */
  suggestedCoverUrl?: string | null;
  onSubmit: (input: BookInput) => void;
  onCancel: () => void;
};

export function ManualEntryForm({ scannedCode, suggestedCoverUrl = null, onSubmit, onCancel }: ManualEntryFormProps) {
  // Lue UNE fois à l'ouverture (le formulaire ne monte que côté client) : la
  // valeur pré-remplie appartient ensuite à l'utilisateur.
  const lastSeries = useMemo(() => loadLastManualSeries(), []);
  const [title, setTitle] = useState("");
  const [seriesName, setSeriesName] = useState(lastSeries?.seriesName ?? "");
  const [issueNumber, setIssueNumber] = useState("");
  const [authors, setAuthors] = useState("");
  const [publisher, setPublisher] = useState("");
  const [pageCount, setPageCount] = useState("");
  const [category, setCategory] = useState<BookCategory>(lastSeries?.category ?? "bd");

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

  const inputClass = "w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2.5";

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-bold">Saisie manuelle</h2>
      {suggestedCoverUrl ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
          <BookCover coverUrl={suggestedCoverUrl} size="large" />
          <p className="text-sm">
            On a trouvé la couverture chez les libraires, mais ce livre n'est répertorié dans aucune base
            bibliographique — remplis ses infos (elles sont sous tes yeux !) et il sera nickel dans ta PAL.
          </p>
        </div>
      ) : (
        scannedCode && (
          <p className="text-sm opacity-70">
            Code scanné mais introuvable : <code className="font-mono">{scannedCode}</code> — il sera gardé avec le livre.
          </p>
        )
      )}

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium opacity-80">Titre *</span>
        <input autoFocus={lastSeries === null} value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} />
      </label>
      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium opacity-80">Série</span>
          <input value={seriesName} onChange={(event) => setSeriesName(event.target.value)} className={inputClass} />
        </label>
        <label className="flex w-24 flex-col gap-1.5 text-sm">
          <span className="font-medium opacity-80">N°</span>
          {/* Série pré-remplie → le curseur part sur le numéro : « la 2ᵉ issue prend 3 secondes » (§5.3). */}
          <input autoFocus={lastSeries !== null} value={issueNumber} onChange={(event) => setIssueNumber(event.target.value)} className={inputClass} />
        </label>
      </div>
      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium opacity-80">Auteur·ice·s</span>
          <input value={authors} onChange={(event) => setAuthors(event.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium opacity-80">Éditeur</span>
          <input value={publisher} onChange={(event) => setPublisher(event.target.value)} className={inputClass} />
        </label>
      </div>
      <label className="flex w-32 flex-col gap-1.5 text-sm">
        <span className="font-medium opacity-80">Pages</span>
        <input
          type="number"
          min={1}
          value={pageCount}
          onChange={(event) => setPageCount(event.target.value)}
          className={inputClass}
        />
      </label>

      <fieldset>
        <legend className="mb-2 text-sm font-medium opacity-80">Catégorie</legend>
        <CategoryPicker value={category} onChange={setCategory} />
      </fieldset>

      <div className="mt-2 flex gap-3">
        <button
          type="button"
          disabled={!title.trim()}
          onClick={submit}
          className="flex-1 rounded-full bg-amber-500 px-6 py-3 font-semibold text-black transition-opacity disabled:opacity-50"
        >
          Continuer
        </button>
        <button type="button" onClick={onCancel} className="px-4 text-sm opacity-60">
          Annuler
        </button>
      </div>
    </section>
  );
}
