"use client";

import { useState } from "react";
import { BookCover } from "@/components/book-cover";
import { CategoryPicker } from "@/components/category-picker";
import { displayableIssueNumber, formatBookSubtitle } from "@/lib/books/format";
import { localToday } from "@/lib/dates";
import { SCORING_SCALE } from "@/lib/scoring/scale";
import type { BookInput } from "@/lib/books/actions";
import type { ResolvedBook } from "@/lib/resolution/types";
import type { BookCategory } from "@/lib/scoring/types";

/**
 * La feuille d'actions — specs §4.1 : le scan a résolu un livre, l'app DEMANDE
 * l'intention (« je commence » / « je l'achète », deux gros boutons, deux
 * effets opposés sur le score). La catégorie proposée se corrige en un tap,
 * la date est pré-remplie à aujourd'hui mais modifiable.
 */

/** Le malus affiché vient du barème — jamais recopié en dur (CLAUDE.md). */
const PENALTY_POINTS = Math.abs(SCORING_SCALE.unreadPurchasePenalty);

type BookActionSheetProps = {
  book: ResolvedBook;
  /** Le code réellement scanné — prioritaire sur celui connu de la source. */
  scannedCode: string | null;
  /**
   * Le livre a déjà été TERMINÉ (specs §4.2) : la question « tu le relis ? »
   * est posée par l'écran, le bouton devient la réponse explicite — commencer
   * crée une relecture, « Annuler » est le non.
   */
  isRereadingPrompt?: boolean;
  onStartReading: (input: BookInput, date: string) => void;
  onPurchase: (input: BookInput, date: string) => void;
  onCancel: () => void;
  isSubmitting: boolean;
};

export function BookActionSheet({
  book,
  scannedCode,
  isRereadingPrompt = false,
  onStartReading,
  onPurchase,
  onCancel,
  isSubmitting,
}: BookActionSheetProps) {
  // Sans numéro affichable (dont le « [nn] » GCD, issue #58) : la série seule —
  // plus jamais de « #[nn] » ni de « #? » qui partirait en base dans le titre.
  const issueNumber = displayableIssueNumber(book.issueNumber);
  const defaultTitle = book.title ?? (book.seriesName ? (issueNumber ? `${book.seriesName} #${issueNumber}` : book.seriesName) : "");
  const [title, setTitle] = useState(defaultTitle);
  const [category, setCategory] = useState<BookCategory>(book.suggestedCategory);
  const [date, setDate] = useState(localToday());

  const buildInput = (): BookInput => ({
    title,
    seriesName: book.seriesName,
    issueNumber: book.issueNumber,
    authors: book.authors,
    publisher: book.publisher,
    pageCount: book.pageCount,
    coverUrl: book.coverUrl,
    category,
    barcodeRaw: scannedCode ?? book.barcode,
    barcodeType: book.barcodeType,
    isbn: book.isbn,
    metadataSource: book.source,
    metadataSourceId: book.sourceId,
  });

  return (
    <section className="flex flex-col gap-5">
      <div className="flex gap-4">
        <BookCover coverUrl={book.coverUrl} size="large" />
        <div className="min-w-0">
          <input
            aria-label="Titre"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full rounded-md border border-foreground/20 bg-transparent px-2 py-1.5 font-semibold"
          />
          <p className="mt-1.5 truncate text-sm opacity-70">
            {formatBookSubtitle(book.seriesName, book.issueNumber, book.publisher)}
          </p>
          {book.pageCount !== null && <p className="text-sm opacity-70">{book.pageCount} pages</p>}
          {book.authors && <p className="truncate text-sm opacity-70">{book.authors}</p>}
          {(scannedCode ?? book.barcode) && (
            <p className="mt-1 font-mono text-xs opacity-50">
              {scannedCode ?? book.barcode}
              {scannedCode && ` · ${scannedCode.length} chiffres`}
            </p>
          )}
        </div>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium opacity-80">Catégorie (proposée — corrige si besoin)</legend>
        <CategoryPicker value={category} onChange={setCategory} />
      </fieldset>

      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium opacity-80">Date</span>
        <input
          type="date"
          value={date}
          // Pas de date future : on borne la SÉLECTION côté client (le fuseau local, pas UTC).
          max={localToday()}
          onChange={(event) => setDate(event.target.value)}
          className="rounded-md border border-foreground/20 bg-transparent px-3 py-2"
        />
      </label>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          disabled={isSubmitting || !title.trim()}
          onClick={() => onStartReading(buildInput(), date)}
          className="rounded-full bg-amber-500 px-6 py-4 text-lg font-semibold text-black transition-opacity disabled:opacity-50"
        >
          {isRereadingPrompt ? "Oui, je le relis" : "Je commence"}
        </button>
        <button
          type="button"
          disabled={isSubmitting || !title.trim()}
          onClick={() => onPurchase(buildInput(), date)}
          className="rounded-full border-2 border-amber-500 px-6 py-4 text-lg font-semibold text-amber-500 transition-opacity disabled:opacity-50"
        >
          Je l&apos;achète <span className="text-sm font-normal opacity-80">(−{PENALTY_POINTS} point, effaçable)</span>
        </button>
        <button type="button" onClick={onCancel} disabled={isSubmitting} className="py-2 text-sm opacity-60">
          Annuler
        </button>
      </div>
    </section>
  );
}
