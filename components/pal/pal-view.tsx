"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { BookRow } from "@/components/ui/book-row";
import { Button } from "@/components/ui/button";
import { SortSelect } from "@/components/ui/sort-select";
import { StatTile } from "@/components/ui/stat-tile";
import { Toast } from "@/components/ui/toast";
import { burstConfetti } from "@/components/ui/confetti";
import { ErrorAlert } from "@/components/error-alert";
import { ReadingRoulette } from "@/components/pal/reading-roulette";
import { FinishReadingButton, RemoveButton, StartReadingButton, useBookGestures } from "@/components/library/book-gestures";
import { endOwnership, endOwnershipsForBooks, markBooksAsRead, softDeletePurchase } from "@/lib/books/actions";
import { formatBulkFailures, type BulkActionResult } from "@/lib/books/bulk-read-plan";
import { NETWORK_ERROR_MESSAGE } from "@/lib/books/errors";
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
 *
 * Le MODE SÉLECTION (#256, maquette validée le 31/08) : « Sélectionner » à
 * côté du tri, cases sur les lignes, barre d'actions au-dessus de la nav.
 * Deux gestes de lot — « Marquer comme lus » (feuille : date commune, ou
 * lecture passée sans date = 0 point) et « Je ne le possède plus » (confirmé :
 * le lot multiplie la fausse manip, l'unitaire reste sans confirmation §4.6).
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

/** L'accord du message avec la taille du lot — window.confirm, l'idiome Biblio. */
function bulkDisposeConfirmMessage(count: number): string {
  return count === 1
    ? "Ne plus posséder ce livre ? Il quittera la pile — lectures, achats et points restent au bilan."
    : `Ne plus posséder ces ${count} livres ? Ils quitteront la pile — lectures, achats et points restent au bilan.`;
}

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
  const { run, isPending, error, setError } = useBookGestures();

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

  // Le mode sélection (#256). La sélection se vide en SORTANT du mode — jamais
  // de sélection fantôme qui survivrait à un aller-retour.
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [isReadSheetOpen, setIsReadSheetOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isBulkPending, startBulkTransition] = useTransition();
  // Mémoïsé (review #259) : l'effet de la feuille en dépend — une identité
  // instable rejouait le focus du CTA à chaque bascule d'état du parent.
  const closeReadSheet = useCallback(() => setIsReadSheetOpen(false), []);

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

  /** bookId → titre, pour retraduire les échecs partiels du serveur. */
  const titleById = useMemo(() => new Map(entries.map((entry) => [entry.bookId, entry.title])), [entries]);

  function exitSelection() {
    setIsSelecting(false);
    setSelectedIds(new Set());
  }

  function toggleSelection(bookId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  }

  /**
   * La plomberie des gestes de LOT — le miroir de `useBookGestures.run`, pour
   * un `BulkActionResult` : « on continue et on rapporte ». La sélection n'est
   * quittée QUE si au moins un livre a suivi (un lot entièrement refusé laisse
   * l'utilisateur corriger sans tout recocher).
   */
  function runBulk(action: () => Promise<BulkActionResult>, onSucceeded: (count: number) => void) {
    setError(null);
    startBulkTransition(async () => {
      try {
        const result = await action();
        setIsReadSheetOpen(false);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        const failureText = formatBulkFailures(result.failures, (bookId) => titleById.get(bookId));
        if (failureText !== null) setError(failureText);
        if (result.succeeded > 0) {
          onSucceeded(result.succeeded);
          exitSelection();
        }
      } catch {
        // Serveur injoignable : la promesse de la Server Action rejette.
        setIsReadSheetOpen(false);
        setError(NETWORK_ERROR_MESSAGE);
      }
    });
  }

  function submitBulkRead(finishedAt: IsoDate | null, confettiOrigin: { x: number; y: number }) {
    runBulk(
      () => markBooksAsRead([...selectedIds], finishedAt),
      (count) => {
        const plural = count > 1 ? "s" : "";
        if (finishedAt !== null) {
          setToastMessage(`${count} lecture${plural} enregistrée${plural} ✓`);
          burstConfetti(confettiOrigin);
        } else {
          setToastMessage(`${count} lecture${plural} passée${plural} — 0 point`);
        }
      },
    );
  }

  function handleBulkDispose() {
    // Confirmation sur le LOT seulement (#256) : le geste unitaire de la pile
    // reste sans confirmation — il est réversible (§4.6), le lot non-trivial à
    // refaire. Même idiome que « Retirer de ma bibliothèque » (library-view).
    if (!window.confirm(bulkDisposeConfirmMessage(selectedIds.size))) return;
    runBulk(
      () => endOwnershipsForBooks([...selectedIds], localToday()),
      (count) =>
        setToastMessage(count > 1 ? `${count} livres ne sont plus possédés` : "1 livre n'est plus possédé"),
    );
  }

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
              // Court exprès (retour preview #242) : le hint doit tenir sur UNE
              // ligne pour que la tuile garde sa hauteur — l'explication
              // complète vit dans l'aria-label du bouton.
              isMonthFilterActive
                ? "filtre actif"
                : `${monthEntries} entrée${monthEntries > 1 ? "s" : ""} · ${monthExits} sortie${monthExits > 1 ? "s" : ""}`
            }
            // `ring`, PAS `border-cyan` (retour preview #242) : la couleur de
            // bordure perdait contre le `border-line` de la tuile selon l'ordre
            // du CSS compilé — le piège documenté au Button (#84). Le ring est
            // une ombre : aucune collision possible, visible à coup sûr.
            className={isMonthFilterActive ? "ring-2 ring-cyan" : ""}
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
              {/* La roulette (#262) : le tirage au sort de la prochaine lecture —
                  autonome (overlay, gestes, toast), la vue ne fait que la poser là. */}
              <ReadingRoulette entries={entries} disabled={isSelecting || isBulkPending} />
              <Button
                type="button"
                variant="ghost"
                aria-pressed={isSelecting}
                disabled={isBulkPending}
                onClick={() => (isSelecting ? exitSelection() : setIsSelecting(true))}
              >
                {isSelecting ? "Annuler" : "Sélectionner"}
              </Button>
            </div>
          )}
          {sortedEntries.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink2">
              {isMonthFilterActive && searchText.trim() === ""
                ? "Aucune entrée de ce mois-ci n'est encore en pile — un livre entré puis lu dans le mois est déjà au Journal."
                : "Aucun livre de la pile ne correspond à la recherche."}
            </p>
          ) : (
          <ul className={`flex flex-col gap-3 ${isSelecting ? "pb-36" : ""}`}>
            {sortedEntries.map((entry) => {
              const isSelected = selectedIds.has(entry.bookId);
              const subtitle = (
                <div className="truncate">
                  {formatBookSubtitle(entry.seriesName, entry.issueNumber, CATEGORY_LABELS[entry.category])}
                </div>
              );
              return (
              <li key={entry.bookId}>
                {isSelecting ? (
                  // La ligne ENTIÈRE devient la case (#256) : gestes et liens de
                  // retrait s'effacent, un tap = cocher. Le liseré cyan suit la
                  // règle du ring (#242) — jamais une couleur de bordure.
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isSelected}
                    disabled={isBulkPending}
                    onClick={() => toggleSelection(entry.bookId)}
                    className={`w-full rounded-card text-left transition active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan disabled:opacity-50 ${
                      isSelected ? "ring-2 ring-cyan" : ""
                    }`}
                  >
                    <BookRow
                      title={entry.title}
                      coverUrl={entry.coverUrl}
                      bookId={entry.bookId}
                      leading={
                        <span
                          aria-hidden
                          className={`flex size-6 shrink-0 items-center justify-center rounded-lg border-2 text-sm font-black ${
                            isSelected ? "border-cyan bg-cyan text-bg0" : "border-ink3 text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                      }
                      meta={
                        <>
                          {subtitle}
                          <div className="mt-0.5 text-ink3">{entryLabel(entry)}</div>
                        </>
                      }
                    />
                  </button>
                ) : (
                  <BookRow
                    title={entry.title}
                    coverUrl={entry.coverUrl}
                    bookId={entry.bookId}
                    meta={
                      <>
                        {subtitle}
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
                )}
              </li>
              );
            })}
          </ul>
          )}
        </>
      )}

      {/* La barre d'actions du lot — au-DESSUS de la nav (maquette validée),
          même étage que le Toast (bottom-24). */}
      {isSelecting && (
        <div className="fixed inset-x-0 bottom-24 z-20 px-4">
          <div className="shadow-float mx-auto flex max-w-md flex-col gap-2.5 rounded-card border border-line bg-card2 p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-ink">
                <span className="tabular-nums text-cyan">{selectedIds.size}</span> livre
                {selectedIds.size > 1 ? "s" : ""} sélectionné{selectedIds.size > 1 ? "s" : ""}
              </p>
              <button
                type="button"
                onClick={exitSelection}
                disabled={isBulkPending}
                className="text-sm text-ink3 underline underline-offset-2 disabled:opacity-40"
              >
                Annuler
              </button>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="done"
                className="flex-1"
                disabled={selectedIds.size === 0 || isBulkPending}
                onClick={() => setIsReadSheetOpen(true)}
              >
                Marquer comme lus
              </Button>
              <Button
                type="button"
                variant="danger"
                className="flex-1"
                disabled={selectedIds.size === 0 || isBulkPending}
                onClick={handleBulkDispose}
              >
                Je ne le possède plus
              </Button>
            </div>
          </div>
        </div>
      )}

      {isReadSheetOpen && (
        <BulkReadSheet
          count={selectedIds.size}
          isPending={isBulkPending}
          onCancel={closeReadSheet}
          onSubmit={submitBulkRead}
        />
      )}

      <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </div>
  );
}

/**
 * La feuille du « Marquer comme lus » (#256) — patron maison (finished-covers) :
 * dialog, fond cliquable, Échap ; animations neutralisées par le kill-switch
 * prefers-reduced-motion. Les deux modes du ticket :
 *  - « Je viens de les lire » : UNE date commune, les points tombent dans le
 *    bilan de ce mois-là ;
 *  - « Lectures passées, date inconnue » : sortie de pile sans toucher aucun
 *    mois — 0 point (principe #101, leçon de #254).
 */
function BulkReadSheet({
  count,
  isPending,
  onCancel,
  onSubmit,
}: {
  count: number;
  isPending: boolean;
  onCancel: () => void;
  onSubmit: (finishedAt: IsoDate | null, confettiOrigin: { x: number; y: number }) => void;
}) {
  const [mode, setMode] = useState<"dated" | "undated">("dated");
  const [date, setDate] = useState(localToday());
  const ctaRef = useRef<HTMLButtonElement>(null);

  // Échap ferme ; le focus part sur le CTA à l'ouverture (dialog).
  useEffect(() => {
    ctaRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const plural = count > 1 ? "s" : "";
  const dateMissing = mode === "dated" && date.trim() === "";

  const options = [
    {
      value: "dated" as const,
      label: "Je viens de les lire",
      hint: "Une date commune pour le lot — les points tombent dans le bilan du mois choisi.",
    },
    {
      value: "undated" as const,
      label: "Lectures passées, date inconnue",
      hint: "Ils sortent de la pile sans toucher aucun mois — 0 point, un fait de bibliothèque.",
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Marquer ${count} livre${plural} comme lu${plural}`}
      className="animate-[fade-in_240ms_ease] fixed inset-0 z-50 flex items-end bg-black/60"
      onClick={onCancel}
    >
      <div
        className="animate-[sheet-in_280ms_cubic-bezier(0.32,0.72,0.24,1)] w-full rounded-t-2xl border-t border-line bg-card p-4 pb-8"
        onClick={(event) => event.stopPropagation()}
      >
        <div aria-hidden className="mx-auto h-1 w-10 rounded-full bg-line" />
        <h2 className="mt-3 text-base font-black text-ink">
          Marquer {count} livre{plural} comme lu{plural}
        </h2>
        <p className="mt-1 text-sm text-ink3">La même règle s&apos;applique à toute la sélection.</p>

        <fieldset className="mt-3">
          <legend className="sr-only">Quand ces lectures ont-elles eu lieu ?</legend>
          <div className="flex flex-col gap-2">
            {options.map((option) => {
              const active = mode === option.value;
              return (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-cyan ${
                    active ? "border-cyan bg-card2" : "border-line bg-card"
                  }`}
                >
                  <input
                    type="radio"
                    name="bulk-read-mode"
                    value={option.value}
                    checked={active}
                    onChange={() => setMode(option.value)}
                    className="sr-only"
                  />
                  {/* La pastille radio, dessinée sur les tokens — l'input natif reste pour le clavier. */}
                  <span
                    aria-hidden
                    className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2 ${
                      active ? "border-cyan" : "border-ink3"
                    }`}
                  >
                    {active && <span className="size-2 rounded-full bg-cyan" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink">{option.label}</span>
                    <span className="block text-xs text-ink3">{option.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {mode === "dated" && (
          <label className="mt-3 flex items-center gap-2.5 pl-7 text-sm text-ink2">
            Terminé{plural} le
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="rounded-xl border border-line bg-card2 px-3 py-2 text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
            />
          </label>
        )}

        <div className="mt-4 flex flex-col gap-3">
          <Button
            ref={ctaRef}
            type="button"
            variant="done"
            block
            disabled={isPending || dateMissing}
            onClick={(event) => {
              // Le centre du bouton AU TAP (même piège qu'au Journal) : la
              // feuille se ferme au succès, son rect ne vaudrait plus rien.
              const rect = event.currentTarget.getBoundingClientRect();
              onSubmit(mode === "dated" ? date : null, {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2,
              });
            }}
          >
            Marquer comme lu{plural} ✓
          </Button>
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="py-2 text-sm text-ink3 disabled:opacity-50"
          >
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}
