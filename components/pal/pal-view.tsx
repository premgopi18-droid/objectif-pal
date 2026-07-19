"use client";

import { useState, useTransition } from "react";
import { startReadingForBook } from "@/lib/books/journal-actions";
import { softDeletePurchase } from "@/lib/books/actions";
import { BookCover } from "@/components/book-cover";
import { ErrorAlert } from "@/components/error-alert";
import { NETWORK_ERROR_MESSAGE } from "@/lib/books/errors";
import { CATEGORY_LABELS } from "@/lib/books/categories";
import { formatBookSubtitle } from "@/lib/books/format";
import { formatDateFrench, localCurrentMonth, localToday } from "@/lib/dates";
import type { PalEntry } from "@/lib/pal/derive-pal";

/**
 * La vue PAL — la pile à lire et sa santé (specs §4.5 et §4.6). Le geste :
 * un tap sur un livre non lu = « je le commence » (l'achat reste, la lecture
 * s'ajoute). Les sorties ne comptent QUE les livres possédés terminés — le
 * piège des deux dénominateurs (§4.5) : une lecture d'emprunt ne vide pas la
 * pile. La sémantique (entrées, sorties, rachats) vit dans lib/pal/derive-pal.
 */

type PalViewProps = {
  entries: PalEntry[];
  /** Les dates d'ENTRÉE de pile (les achats, hors rachats de déjà-lus — cf. derivePal). */
  purchaseDates: string[];
  /** Les dates de SORTIE de pile (une par livre possédé : sa première fin). */
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
      try {
        const result = await startReadingForBook(bookId, localToday());
        if (!result.ok) setError(result.error);
      } catch {
        // Serveur injoignable (réseau coupé) : la promesse de la Server Action
        // rejette — sans ce catch, le geste échouerait en silence.
        setError(NETWORK_ERROR_MESSAGE);
      }
    });
  }

  // « Je ne l'ai pas acheté » : annule l'achat qui a fait entrer le livre en
  // pile (specs §4.6). Le livre disparaît de la liste au revalidate.
  function removePurchase(purchaseId: string) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await softDeletePurchase(purchaseId);
        if (!result.ok) setError(result.error);
      } catch {
        setError(NETWORK_ERROR_MESSAGE);
      }
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

      {error && <ErrorAlert message={error} />}

      {entries.length === 0 ? (
        <p className="text-sm opacity-70">
          Ta pile est vide — soit tu es un paliste modèle, soit tu n&apos;as pas encore scanné tes achats 🙂
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li key={entry.bookId} className="flex items-center gap-3 rounded-xl border border-foreground/10 p-3">
              <BookCover coverUrl={entry.coverUrl} size="small" bookId={entry.bookId} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold leading-tight">{entry.title}</p>
                <p className="mt-0.5 truncate text-sm opacity-70">
                  {formatBookSubtitle(entry.seriesName, entry.issueNumber, CATEGORY_LABELS[entry.category])}
                </p>
                <p className="text-xs opacity-60">Acheté le {formatDateFrench(entry.purchasedAt)}</p>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => removePurchase(entry.purchaseId)}
                  className="mt-1 text-xs underline opacity-50 disabled:opacity-30"
                >
                  Je ne l&apos;ai pas acheté
                </button>
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
