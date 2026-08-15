"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { BookRow } from "@/components/ui/book-row";
import { SortSelect } from "@/components/ui/sort-select";
import { StatTile } from "@/components/ui/stat-tile";
import { ErrorAlert } from "@/components/error-alert";
import { FinishReadingButton, RemoveButton, StartReadingButton, useBookGestures } from "@/components/library/book-gestures";
import { endOwnership, softDeletePurchase } from "@/lib/books/actions";
import { CATEGORY_LABELS } from "@/lib/books/categories";
import { formatBookSubtitle } from "@/lib/books/format";
import { formatDateFrench, localCurrentMonth, localToday } from "@/lib/dates";
import type { PalEntry } from "@/lib/pal/derive-pal";
import type { IsoDate } from "@/lib/scoring/types";
import { computePalHealth, isMonthEntry } from "@/lib/pal/health";
import { matchesSearch } from "@/lib/search/entry-search";
import { ENTRY_SORT_LABELS, sortEntriesBy, type EntrySortOption } from "@/lib/sort/entry-sort";

/** Les tris de la pile (#217) — pas d'« activité » ici : une pile n'a que des non-lus. */
type PalSortOption = Exclude<EntrySortOption, "activite">;
const PAL_SORT_OPTIONS = (["ajout", "ajout-ancien", "titre", "titre-inverse"] as const).map((value) => ({
  value,
  label: ENTRY_SORT_LABELS[value],
}));

/**
 * La vue PAL — la pile à lire et sa santé (specs §4.5 et §4.6). Le geste :
 * un tap sur un livre non lu = « je le commence » (l'achat reste, la lecture
 * s'ajoute). Les sorties ne comptent QUE les livres possédés terminés — le
 * piège des deux dénominateurs (§4.5) : une lecture d'emprunt ne vide pas la
 * pile. La sémantique (entrées, sorties, rachats) vit dans lib/pal/derive-pal.
 */

/**
 * Ce qui date l'entrée en pile, selon sa SOURCE (#101) : un achat se dit
 * « acheté le », une possession déclarée « possédé depuis » — et quand la date
 * est inconnue (l'étagère d'avant l'app), on ne l'invente pas.
 */
function entryLabel(entry: PalEntry): string {
  if (entry.enteredAt === null) return "Déjà dans ma bibliothèque";
  return entry.entrySource.kind === "purchase"
    ? `Acheté le ${formatDateFrench(entry.enteredAt)}`
    : `Possédé depuis le ${formatDateFrench(entry.enteredAt)}`;
}

/** Capture l'id hors du JSX : le narrowing d'un champ ne survit pas à la closure. */
const softDeletePurchaseAction = (purchaseId: string) => () => softDeletePurchase(purchaseId);

/**
 * « Je ne le possède plus » depuis la pile — le livre n'a jamais été lu, donc
 * la sortie est datée d'aujourd'hui (fuseau LOCAL, jamais l'UTC du serveur).
 */
const endOwnershipAction = (bookId: string) => () => endOwnership(bookId, localToday());

type PalViewProps = {
  entries: PalEntry[];
  /** Les dates d'ENTRÉE de pile connues (hors acquisitions de déjà-lus — cf. derivePal). */
  entryDates: string[];
  /** Les dates de SORTIE de pile connues (une par livre possédé : sa première fin). */
  exitDates: string[];
  /** Les livres entrés/sortis à une date inconnue (#101) — du stock, jamais du flux. */
  undatedEntryCount?: number;
  undatedExitCount?: number;
  /** Les sorties par cession (#142) — stock seul, jamais le flux du mois. */
  disposalExitDates?: IsoDate[];
};

export function PalView({
  entries,
  entryDates,
  exitDates,
  undatedEntryCount,
  undatedExitCount,
  disposalExitDates,
}: PalViewProps) {
  const { run, isPending, error } = useBookGestures();

  // « Ajout récent » par défaut (#217) : le dernier scan en haut de la pile.
  const [sortOption, setSortOption] = useState<PalSortOption>("ajout");
  // La recherche (#222) — en MÉMOIRE : la pile n'est pas paginée (contrairement
  // au journal), et la normalisation est celle du module commun (accents,
  // ligatures) — « asterix » trouve Astérix ici comme partout.
  const [searchText, setSearchText] = useState("");
  // Le filtre de la tuile « Pile ce mois-ci » (#241) — en mémoire, comme la
  // recherche et le tri : l'idiome de cette surface. Il ne montre que les
  // ENTRÉES du mois encore en pile — les sorties sont des lectures (#142),
  // elles ont quitté la liste, leur récit vit au Journal.
  const [isMonthFilterActive, setIsMonthFilterActive] = useState(false);
  const currentMonth = localCurrentMonth();
  const sortedEntries = useMemo(
    () =>
      sortEntriesBy(
        entries
          .filter((entry) => !isMonthFilterActive || isMonthEntry(entry.enteredAt, currentMonth))
          .filter((entry) =>
            matchesSearch(entry, searchText, { title: (item) => item.title, seriesName: (item) => item.seriesName }),
          ),
        sortOption,
        {
          createdAt: (entry) => entry.createdAt,
          title: (entry) => entry.title,
        },
      ),
    [entries, searchText, sortOption, isMonthFilterActive, currentMonth],
  );

  // La santé du mois — dérivation PARTAGÉE (lib/pal/health), calculée avec le
  // mois LOCAL de l'appareil. La vue ne recompte plus rien elle-même.
  const { pileSize, monthEntries, monthExits, monthBalance } = computePalHealth(
    { entryDates, exitDates, undatedEntryCount, undatedExitCount, disposalExitDates },
    currentMonth,
  );

  return (
    <div className="mt-4 flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3">
        {/* Solde POSITIF = la pile gonfle = rouge ; négatif = vert (specs design §2).
            Cette tuile-ci reste INERTE (#241, décision) : sur ce segment, la
            liste EST déjà « Dans la pile » — un filtre qui ne change rien
            apprendrait que les tuiles sont parfois mortes. */}
        <StatTile label="Dans la pile" value={pileSize} hint={`livre${pileSize > 1 ? "s" : ""} non lu${pileSize > 1 ? "s" : ""}`} />
        {/* La tuile parle de LIVRES, jamais d'un nombre signé nu (#133,
            found-in-prod) : « −8 » se lisait comme un score de −8 points,
            alors que c'est le flux de la pile — le score vit au Bilan.
            Depuis #241 c'est aussi un FILTRE : un tap ne montre que les
            entrées du mois encore en pile, un tap ramène tout. */}
        <button
          type="button"
          onClick={() => setIsMonthFilterActive((active) => !active)}
          aria-pressed={isMonthFilterActive}
          aria-label={
            isMonthFilterActive
              ? "Désactiver le filtre des entrées du mois"
              : "Ne montrer que les livres entrés en pile ce mois-ci"
          }
          className="rounded-card text-left transition active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
        >
          <StatTile
            label="Pile ce mois-ci"
            value={`${monthBalance > 0 ? `+${monthBalance}` : monthBalance} livre${Math.abs(monthBalance) > 1 ? "s" : ""}`}
            tone={monthBalance > 0 ? "bad" : "good"}
            hint={
              isMonthFilterActive
                ? "filtre actif — taper pour tout revoir"
                : `${monthEntries} entrée${monthEntries > 1 ? "s" : ""} · ${monthExits} sortie${monthExits > 1 ? "s" : ""}`
            }
            className={isMonthFilterActive ? "border-cyan" : ""}
          />
        </button>
      </div>

      {error && <ErrorAlert message={error} />}

      {entries.length === 0 ? (
        <p className="text-sm text-ink2">
          Ta pile est vide — soit tu es un paliste modèle, soit tu n&apos;as pas encore scanné tes achats 🙂
        </p>
      ) : (
        <>
          {entries.length > 1 && (
            // flex-WRAP obligatoire (bug #221, vu en prod) : un <select> a une
            // largeur incompressible — même patron que la Biblio et le Journal.
            <div className="flex flex-wrap gap-2">
              <input
                type="search"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Rechercher un titre ou une série…"
                aria-label="Rechercher dans la pile"
                className="min-w-[12rem] flex-1 rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink placeholder:text-ink3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
              />
              <SortSelect value={sortOption} options={PAL_SORT_OPTIONS} onChange={setSortOption} className="min-w-[9rem] flex-1" />
            </div>
          )}
          {sortedEntries.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink2">
              {isMonthFilterActive && searchText.trim() === ""
                ? "Aucune entrée de ce mois-ci n'est encore en pile — un livre entré puis lu dans le mois est déjà au Journal."
                : "Aucun livre de la pile ne correspond à la recherche."}
            </p>
          ) : (
          <ul className="flex flex-col gap-3">
            {sortedEntries.map((entry) => (
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
                      <span>{entryLabel(entry)}</span>
                      {/* Le geste de retrait suit la SOURCE d'entrée (#101) : on
                          n'annule pas un achat qui n'existe pas.
                          — entré par un achat → « Je ne l'ai pas acheté », qui annule
                            l'achat (§4.6). Réversible → pas de confirmation.
                          — entré par « je possède » → « Je ne le possède plus », qui
                            clôt la possession sans toucher à l'historique. */}
                      {entry.entrySource.kind === "purchase" ? (
                        <RemoveButton
                          label="Je ne l'ai pas acheté"
                          action={softDeletePurchaseAction(entry.entrySource.purchaseId)}
                          run={run}
                          isPending={isPending}
                          tone="muted"
                          className="text-xs"
                        />
                      ) : (
                        <RemoveButton
                          label="Je ne le possède plus"
                          action={endOwnershipAction(entry.bookId)}
                          run={run}
                          isPending={isPending}
                          tone="muted"
                          className="text-xs"
                        />
                      )}
                    </div>
                  </>
                }
                action={
                  entry.isInProgress ? (
                    // « Terminé ✓ » LÀ où le livre est visible (#144) — plus
                    // besoin d'aller au Journal pour le geste des points.
                    <FinishReadingButton bookId={entry.bookId} run={run} isPending={isPending} />
                  ) : (
                    <StartReadingButton bookId={entry.bookId} run={run} isPending={isPending} />
                  )
                }
              />
            </li>
            ))}
          </ul>
          )}
        </>
      )}
    </div>
  );
}
