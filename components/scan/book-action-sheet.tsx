"use client";

import { useState } from "react";
import { BookCover } from "@/components/book-cover";
import { CategoryPicker } from "@/components/category-picker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { displayableIssueNumber, formatBookSubtitle } from "@/lib/books/format";
import { localToday } from "@/lib/dates";
import { SCORING_SCALE } from "@/lib/scoring/scale";
import type { BookInput } from "@/lib/books/actions";
import type { ResolvedBook } from "@/lib/resolution/types";
import type { BookCategory } from "@/lib/scoring/types";

/**
 * La feuille d'actions — specs §4.1 : le scan a résolu un livre, l'app DEMANDE
 * l'intention (« Commencer la lecture » / « Enregistrer un achat », deux gros
 * boutons, deux effets opposés sur le score). La catégorie proposée se corrige
 * en un tap, la date est pré-remplie à aujourd'hui mais modifiable.
 */

/** Le malus affiché vient du barème — jamais recopié en dur (CLAUDE.md). */
const PENALTY_POINTS = Math.abs(SCORING_SCALE.unreadPurchasePenalty);

/** Les champs de la feuille, stylés une fois sur les tokens (§2). */
const INPUT_CLASS =
  "w-full rounded-xl border border-line bg-card2 px-3 py-2.5 text-ink placeholder:text-ink3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan";

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
      <Card className="flex gap-4">
        <BookCover coverUrl={book.coverUrl} size="large" title={title} />
        <div className="min-w-0 flex-1">
          <input
            aria-label="Titre"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={`${INPUT_CLASS} font-semibold`}
          />
          <p className="mt-1.5 truncate text-sm text-ink2">
            {formatBookSubtitle(book.seriesName, book.issueNumber, book.publisher)}
          </p>
          {book.pageCount !== null && <p className="text-sm text-ink2">{book.pageCount} pages</p>}
          {book.authors && <p className="truncate text-sm text-ink2">{book.authors}</p>}
          {(scannedCode ?? book.barcode) && (
            <p className="mt-1 font-mono text-xs text-ink3">
              {scannedCode ?? book.barcode}
              {scannedCode && ` · ${scannedCode.length} chiffres`}
            </p>
          )}
        </div>
      </Card>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink2">Catégorie (proposée — corrige si besoin)</legend>
        <CategoryPicker value={category} onChange={setCategory} />
      </fieldset>

      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-ink2">Date</span>
        <input
          type="date"
          value={date}
          // Pas de date future : on borne la SÉLECTION côté client (le fuseau local, pas UTC).
          max={localToday()}
          onChange={(event) => setDate(event.target.value)}
          className="rounded-xl border border-line bg-card2 px-3 py-2 text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
        />
      </label>

      <div className="flex flex-col gap-3">
        {/* Le bon geste, au dégradé signature (CTA §2). */}
        <Button
          type="button"
          variant="grad"
          block
          disabled={isSubmitting || !title.trim()}
          onClick={() => onStartReading(buildInput(), date)}
        >
          {isRereadingPrompt ? "Oui, je le relis" : "Commencer la lecture"}
        </Button>
        {/* L'achat pèse sur le score : malus en rouge sémantique (§2). */}
        <Button
          type="button"
          variant="ghost"
          block
          disabled={isSubmitting || !title.trim()}
          onClick={() => onPurchase(buildInput(), date)}
        >
          Enregistrer un achat <span className="text-sm font-normal text-red">(−{PENALTY_POINTS} point, effaçable)</span>
        </Button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="py-2 text-sm text-ink3 disabled:opacity-50"
        >
          Annuler
        </button>
      </div>
    </section>
  );
}
