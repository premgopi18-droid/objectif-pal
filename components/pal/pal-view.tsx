"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import { startReadingForBook } from "@/lib/books/journal-actions";
import { CATEGORY_LABELS } from "@/lib/books/categories";
import { formatDateFrench, localCurrentMonth, localToday } from "@/lib/dates";
import type { BookCategory } from "@/lib/scoring/types";

/**
 * La vue PAL — la pile à lire et sa santé (specs §4.5 et §4.6). Le geste :
 * un tap sur un livre non lu = « je le commence » (l'achat reste, la lecture
 * s'ajoute). Les sorties ne comptent QUE les livres possédés terminés — le
 * piège des deux dénominateurs (§4.5) : une lecture d'emprunt ne vide pas la pile.
 */

export type PalEntry = {
  bookId: string;
  title: string;
  seriesName: string | null;
  issueNumber: string | null;
  category: BookCategory;
  coverUrl: string | null;
  purchasedAt: string;
  isInProgress: boolean;
};

type PalViewProps = {
  entries: PalEntry[];
  /** Toutes les dates d'achat (les ENTRÉES de pile). */
  purchaseDates: string[];
  /** Les dates de fin des lectures de livres POSSÉDÉS (les SORTIES de pile). */
  ownedFinishedDates: string[];
};

export function PalView({ entries, purchaseDates, ownedFinishedDates }: PalViewProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // La santé du mois — calculée avec le mois LOCAL de l'appareil.
  const month = localCurrentMonth();
  const entriesThisMonth = purchaseDates.filter((date) => date.startsWith(month)).length;
  const exitsThisMonth = ownedFinishedDates.filter((date) => date.startsWith(month)).length;
  const balance = entriesThisMonth - exitsThisMonth;

  function startReading(bookId: string) {
    setError(null);
    startTransition(async () => {
      const result = await startReadingForBook(bookId, localToday());
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="mt-4 flex flex-col gap-5">
      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-foreground/10 p-3">
          <dt className="text-xs opacity-60">Dans la pile</dt>
          <dd className="text-2xl font-bold">{entries.length}</dd>
        </div>
        <div className="rounded-xl border border-foreground/10 p-3">
          <dt className="text-xs opacity-60">Solde du mois</dt>
          <dd className={`text-2xl font-bold ${balance > 0 ? "text-red-500" : "text-green-500"}`}>
            {balance > 0 ? `+${balance}` : balance}
            <span className="ml-2 text-xs font-normal opacity-60">
              {entriesThisMonth} entrée{entriesThisMonth > 1 ? "s" : ""} · {exitsThisMonth} sortie
              {exitsThisMonth > 1 ? "s" : ""}
            </span>
          </dd>
        </div>
      </dl>

      {error && (
        <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-500">
          {error}
        </p>
      )}

      {entries.length === 0 ? (
        <p className="text-sm opacity-70">
          Ta pile est vide — soit tu es un paliste modèle, soit tu n&apos;as pas encore scanné tes achats 🙂
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li key={entry.bookId} className="flex items-center gap-3 rounded-xl border border-foreground/10 p-3">
              {entry.coverUrl ? (
                <Image src={entry.coverUrl} alt="" width={48} height={72} className="h-18 w-12 shrink-0 rounded object-cover" unoptimized />
              ) : (
                <div aria-hidden className="flex h-18 w-12 shrink-0 items-center justify-center rounded bg-foreground/10">
                  📚
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-semibold leading-tight">{entry.title}</p>
                <p className="mt-0.5 truncate text-sm opacity-70">
                  {[
                    entry.seriesName && entry.issueNumber ? `${entry.seriesName} #${entry.issueNumber}` : entry.seriesName,
                    CATEGORY_LABELS[entry.category],
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="text-xs opacity-60">Acheté le {formatDateFrench(entry.purchasedAt)}</p>
              </div>
              {entry.isInProgress ? (
                <span className="shrink-0 rounded-full bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-500">
                  En cours
                </span>
              ) : (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => startReading(entry.bookId)}
                  className="shrink-0 rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
                >
                  Je le commence
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
