"use client";

import Image from "next/image";
import { useState } from "react";
import { ALL_CATEGORIES, CATEGORY_LABELS } from "@/lib/books/categories";
import type { BookInput } from "@/lib/books/actions";
import type { ResolvedBook } from "@/lib/resolution/types";
import type { BookCategory } from "@/lib/scoring/types";

/**
 * La feuille d'actions — specs §4.1 : le scan a résolu un livre, l'app DEMANDE
 * l'intention (« je commence » / « je l'achète », deux gros boutons, deux
 * effets opposés sur le score). La catégorie proposée se corrige en un tap,
 * la date est pré-remplie à aujourd'hui mais modifiable.
 */

type BookActionSheetProps = {
  book: ResolvedBook;
  /** Le code réellement scanné — prioritaire sur celui connu de la source. */
  scannedCode: string | null;
  onStartReading: (input: BookInput, date: string) => void;
  onPurchase: (input: BookInput, date: string) => void;
  onCancel: () => void;
  isSubmitting: boolean;
};

/** La date locale de l'APPAREIL — jamais celle du serveur (UTC, specs §7). */
const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

export function BookActionSheet({ book, scannedCode, onStartReading, onPurchase, onCancel, isSubmitting }: BookActionSheetProps) {
  const defaultTitle = book.title ?? (book.seriesName ? `${book.seriesName} #${book.issueNumber ?? "?"}` : "");
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
        {book.coverUrl ? (
          <Image
            src={book.coverUrl}
            alt=""
            width={96}
            height={144}
            className="h-36 w-24 shrink-0 rounded-md object-cover"
            unoptimized
          />
        ) : (
          <div aria-hidden className="flex h-36 w-24 shrink-0 items-center justify-center rounded-md bg-foreground/10 text-3xl">
            📚
          </div>
        )}
        <div className="min-w-0">
          <input
            aria-label="Titre"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full rounded-md border border-foreground/20 bg-transparent px-2 py-1.5 font-semibold"
          />
          <p className="mt-1.5 truncate text-sm opacity-70">
            {[book.seriesName && book.issueNumber ? `${book.seriesName} #${book.issueNumber}` : book.seriesName, book.publisher]
              .filter(Boolean)
              .join(" · ")}
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
        <div className="flex flex-wrap gap-2">
          {ALL_CATEGORIES.map((candidate) => (
            <button
              key={candidate}
              type="button"
              onClick={() => setCategory(candidate)}
              aria-pressed={category === candidate}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                category === candidate ? "bg-amber-500 text-black" : "border border-foreground/20 opacity-70"
              }`}
            >
              {CATEGORY_LABELS[candidate]}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium opacity-80">Date</span>
        <input
          type="date"
          value={date}
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
          Je commence
        </button>
        <button
          type="button"
          disabled={isSubmitting || !title.trim()}
          onClick={() => onPurchase(buildInput(), date)}
          className="rounded-full border-2 border-amber-500 px-6 py-4 text-lg font-semibold text-amber-500 transition-opacity disabled:opacity-50"
        >
          Je l&apos;achète <span className="text-sm font-normal opacity-80">(−1 point, effaçable)</span>
        </button>
        <button type="button" onClick={onCancel} disabled={isSubmitting} className="py-2 text-sm opacity-60">
          Annuler
        </button>
      </div>
    </section>
  );
}
