"use client";

import { Badge } from "@/components/ui/badge";
import { BookRow } from "@/components/ui/book-row";
import { StatTile } from "@/components/ui/stat-tile";
import { ErrorAlert } from "@/components/error-alert";
import { RemoveButton, StartReadingButton, useBookGestures } from "@/components/library/book-gestures";
import { softDeletePurchase } from "@/lib/books/actions";
import { CATEGORY_LABELS } from "@/lib/books/categories";
import { formatBookSubtitle } from "@/lib/books/format";
import { formatDateFrench, localCurrentMonth } from "@/lib/dates";
import type { PalEntry } from "@/lib/pal/derive-pal";
import { computePalHealth } from "@/lib/pal/health";

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
  const { run, isPending, error } = useBookGestures();

  // La santé du mois — dérivation PARTAGÉE (lib/pal/health), calculée avec le
  // mois LOCAL de l'appareil. La vue ne recompte plus rien elle-même.
  const { pileSize, monthEntries, monthExits, monthBalance } = computePalHealth(
    { entryDates: purchaseDates, exitDates: ownedFinishedDates },
    localCurrentMonth(),
  );

  return (
    <div className="mt-4 flex flex-col gap-5">
      <dl className="grid grid-cols-2 gap-3">
        {/* Solde POSITIF = la pile gonfle = rouge ; négatif = vert (specs design §2). */}
        <StatTile label="Dans la pile" value={pileSize} hint={`livre${pileSize > 1 ? "s" : ""} non lu${pileSize > 1 ? "s" : ""}`} />
        <StatTile
          label="Solde du mois"
          value={monthBalance > 0 ? `+${monthBalance}` : monthBalance}
          tone={monthBalance > 0 ? "bad" : "good"}
          hint={`${monthEntries} entrée${monthEntries > 1 ? "s" : ""} · ${monthExits} sortie${monthExits > 1 ? "s" : ""}`}
        />
      </dl>

      {error && <ErrorAlert message={error} />}

      {entries.length === 0 ? (
        <p className="text-sm text-ink2">
          Ta pile est vide — soit tu es un paliste modèle, soit tu n&apos;as pas encore scanné tes achats 🙂
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li key={entry.bookId}>
              <BookRow
                title={entry.title}
                coverUrl={entry.coverUrl}
                bookId={entry.bookId}
                meta={
                  <>
                    <div className="truncate">
                      {formatBookSubtitle(entry.seriesName, entry.issueNumber, CATEGORY_LABELS[entry.category])}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-ink3">
                      <span>Acheté le {formatDateFrench(entry.purchasedAt)}</span>
                      {/* « Je ne l'ai pas acheté » : annule l'achat qui a fait entrer le
                          livre en pile (§4.6). Réversible → pas de confirmation. */}
                      <RemoveButton
                        label="Je ne l'ai pas acheté"
                        action={() => softDeletePurchase(entry.purchaseId)}
                        run={run}
                        isPending={isPending}
                        tone="muted"
                        className="text-xs"
                      />
                    </div>
                  </>
                }
                action={
                  entry.isInProgress ? (
                    <Badge state="reading">En cours</Badge>
                  ) : (
                    <StartReadingButton bookId={entry.bookId} run={run} isPending={isPending} />
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
