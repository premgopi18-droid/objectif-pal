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
  /** « Je le possède » — l'étagère d'avant l'app (#101). Date d'acquisition facultative. */
  onOwn: (input: BookInput, ownedSince: string | null) => void;
  /** « Je l'ai déjà lu » — une lecture passée (#101). Date de fin facultative. */
  onPastReading: (input: BookInput, finishedAt: string | null) => void;
  onCancel: () => void;
  isSubmitting: boolean;
};

export function BookActionSheet({
  book,
  scannedCode,
  isRereadingPrompt = false,
  onStartReading,
  onPurchase,
  onOwn,
  onPastReading,
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
  // L'étagère d'avant l'app n'a pas de date connue (#101). On ne l'invente pas :
  // sans date, le livre compte dans le stock de la PAL sans peser sur les flux
  // du mois, et une lecture passée ne crédite aucun bilan.
  const [dateUnknown, setDateUnknown] = useState(false);
  const shelfDate = dateUnknown ? null : date;

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

      {/* L'étagère d'avant l'app (#101) — volontairement en second rang : ces
          gestes servent au rattrapage, pas au quotidien. Aucun des deux ne
          touche au score. */}
      <section className="flex flex-col gap-3 border-t border-line pt-5">
        <div>
          <h2 className="text-sm font-medium text-ink2">Ce livre est déjà à moi</h2>
          <p className="mt-0.5 text-xs text-ink3">
            Pour les étagères d&apos;avant l&apos;app — aucun effet sur le score.
          </p>
        </div>

        <label className="flex items-center gap-2.5 text-sm text-ink2">
          <input
            type="checkbox"
            checked={dateUnknown}
            onChange={(event) => setDateUnknown(event.target.checked)}
            className="size-4 rounded border-line bg-card2 accent-cyan"
          />
          Je ne sais plus quand
        </label>

        <div className="flex flex-col gap-2.5 sm:flex-row">
          <Button
            type="button"
            variant="ghost"
            block
            disabled={isSubmitting || !title.trim()}
            onClick={() => onOwn(buildInput(), shelfDate)}
          >
            Je le possède
          </Button>
          <Button
            type="button"
            variant="ghost"
            block
            disabled={isSubmitting || !title.trim()}
            onClick={() => onPastReading(buildInput(), shelfDate)}
          >
            Je l&apos;ai déjà lu
          </Button>
        </div>
      </section>
    </section>
  );
}
