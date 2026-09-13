"use client";

import { useEffect, useRef, useState } from "react";
import { ErrorAlert } from "@/components/error-alert";
import { DeclareTotalBlock } from "@/components/series/declare-total-block";
import { SeriesGauge } from "@/components/series/series-card";
import { VolumeNumpadSheet } from "@/components/series/volume-numpad-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/ui/stat-tile";
import { CATEGORY_LABELS } from "@/lib/books/categories";
import { SERIES_STATUS_LABELS, approximateWarning, declaredByLabel, knownMaxExceedsLabel, nextCardCopy } from "@/lib/series/copy";
import type { SeriesProgress, SeriesVolume } from "@/lib/series/derive-series";

/**
 * La fiche d'une série (lot B, maquette cadran A) — plein cadre comme la
 * roulette : en-tête, trois grands compteurs, la carte « à lire ensuite »,
 * l'avertissement « approximatif », la grille des tomes (1..gridMax, tome
 * suivant surligné, cases « ? » pour les tomes lus sans numéro), la légende,
 * le total et son auteur, les gestes : déclarer, modifier, renommer, numéroter.
 *
 * Tout le contenu vient de la dérivation ; la fiche pose, formule via
 * lib/series/copy, et remonte les gestes au parent (qui appelle les actions).
 */

type NextTone = "read" | "buy" | "calm";
const NEXT_TONES: Record<NextTone, string> = {
  read: "border-cyan/30 bg-cyan/10",
  buy: "border-amber/30 bg-amber/10",
  calm: "border-green/30 bg-green/10",
};

/**
 * Le plafond de la grille (review #296) : une série déclarée à 1 000 numéros
 * ou un « tome 2019 » saisi par erreur ne rendent pas mille cellules. Au-delà,
 * une ligne dit ce qui reste ; la fiche garde ses compteurs et son suivant.
 */
export const MAX_GRID_CELLS = 150;

const CELL_STATES: Record<SeriesVolume["state"] | "missing", string> = {
  read: "bg-green/20 text-green border-green/40",
  pile: "bg-amber/20 text-amber border-amber/40",
  other: "bg-card2 text-ink3 border-line",
  missing: "bg-card2 text-ink3 border-line border-dashed",
};

export type SeriesSheetProps = {
  progress: SeriesProgress;
  declarerLabel: string | null;
  isPending: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onDeclareTotal: (total: number) => void;
  onDeclareOngoing: () => void;
  onRename: (name: string) => void;
  onNumberVolume: (bookId: string, rawNumber: string) => Promise<boolean>;
};

export function SeriesSheet({
  progress,
  declarerLabel,
  isPending,
  errorMessage,
  onClose,
  onDeclareTotal,
  onDeclareOngoing,
  onRename,
  onNumberVolume,
}: SeriesSheetProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [isDeclaring, setIsDeclaring] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(progress.name);
  const [numbering, setNumbering] = useState<SeriesVolume | null>(null);
  const [numberingError, setNumberingError] = useState<string | null>(null);

  // Échap ferme ; le focus part sur « Séries » (retour) à l'ouverture (dialog).
  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && numbering === null) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, numbering]);

  // Un fait qui vient d'être déclaré referme le stepper — état dérivé ajusté
  // pendant le rendu (patron React), pas un effet qui re-rend.
  const factKey = `${progress.factDeclaredAt}|${progress.totalVolumes}|${progress.isOngoing}`;
  const [seenFactKey, setSeenFactKey] = useState(factKey);
  if (seenFactKey !== factKey) {
    setSeenFactKey(factKey);
    setIsDeclaring(false);
  }

  const status = SERIES_STATUS_LABELS[progress.status];
  // Le plus grand plancher (GCD ou édition BnF) — celui qui peut dépasser un total déclaré.
  const topKnown = progress.knownMax[0] ?? null;
  const next = progress.next !== null && progress.unnumberedRead === 0 ? nextCardCopy(progress.next, progress.totalVolumes) : null;
  const declared = declaredByLabel(progress, declarerLabel);
  const volumeByNumber = new Map(progress.volumes.filter((volume) => volume.number !== null).map((volume) => [volume.number as number, volume]));
  const unnumbered = progress.volumes.filter((volume) => volume.number === null && volume.state !== "other");
  const nextNumber = progress.next && "number" in progress.next ? progress.next.number : null;
  const takenNumbers = new Set<number>(volumeByNumber.keys());
  const tomes = progress.read + progress.pile;

  return (
    <div role="dialog" aria-modal="true" aria-label={`Série ${progress.name}`} className="animate-[fade-in_240ms_ease] fixed inset-0 z-50 overflow-y-auto bg-bg0">
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col gap-4 px-4 pb-10 pt-5">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          disabled={isPending}
          className="self-start rounded-full py-1 pr-2 text-sm font-semibold text-ink2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan disabled:opacity-40"
        >
          ‹ Séries
        </button>

        <header className="flex flex-col gap-1.5">
          {isRenaming ? (
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const nextName = nameDraft.trim();
                // Le renommage sort du compte : il change le nom pour TOUS les
                // membres (référentiel commun, §4.17-9) — on le dit avant (review #296).
                if (
                  nextName &&
                  nextName !== progress.name &&
                  window.confirm(`Renommer « ${progress.name} » en « ${nextName} » pour tout le monde ?`)
                ) {
                  onRename(nextName);
                }
                setIsRenaming(false);
              }}
            >
              <input
                autoFocus
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                aria-label="Nom de la série"
                maxLength={200}
                className="min-w-0 flex-1 rounded-xl border border-line bg-card px-3 py-2 text-lg font-black text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
              />
              <Button type="submit" variant="grad" disabled={isPending || !nameDraft.trim()}>
                OK
              </Button>
              <Button type="button" variant="ghost" disabled={isPending} onClick={() => setIsRenaming(false)}>
                Annuler
              </Button>
            </form>
          ) : (
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-xl font-black tracking-tight text-ink">{progress.name}</h2>
              <button
                type="button"
                onClick={() => {
                  setNameDraft(progress.name);
                  setIsRenaming(true);
                }}
                disabled={isPending}
                className="flex-none text-sm text-ink2 underline underline-offset-2 disabled:opacity-50"
              >
                Renommer
              </button>
            </div>
          )}
          <p className="text-sm text-ink2">
            {CATEGORY_LABELS[progress.category]} · {tomes} tome{tomes > 1 ? "s" : ""}
            {progress.knownMax.some((known) => known.source === "gcd") && " · numérotation : GCD"}
          </p>
          <div>
            <Badge state={status.badge}>{status.label}</Badge>
          </div>
        </header>

        {errorMessage !== null && <ErrorAlert message={errorMessage} />}

        <div className="grid grid-cols-3 gap-2">
          <StatTile label="Lus" value={progress.read} tone="good" />
          <StatTile label="Dans la pile" value={progress.pile} tone={progress.pile > 0 ? "amber" : "default"} />
          <StatTile label="Total" value={progress.isOngoing ? "∞" : (progress.totalVolumes ?? "?")} />
        </div>

        {next !== null && (
          <div className={`flex items-center gap-3 rounded-card border p-3 ${NEXT_TONES[next.tone]}`}>
            <span aria-hidden className="text-2xl">
              {next.icon}
            </span>
            <div>
              <p className="text-sm font-bold text-ink">{next.title}</p>
              <p className="text-xs text-ink2">{next.body}</p>
            </div>
          </div>
        )}

        {progress.unnumberedRead > 0 && (
          <p className="rounded-card border border-amber/30 bg-amber/10 p-3 text-xs leading-relaxed text-ink2">
            {approximateWarning(progress.unnumberedRead)}
          </p>
        )}

        <SeriesGauge progress={progress} />

        <section aria-label="Les tomes" className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-bold text-ink">Les tomes</h3>
            {unnumbered.length > 0 && <span className="text-xs text-ink3">tap sur ? pour numéroter</span>}
          </div>
          <div className="grid grid-cols-6 gap-1.5">
            {Array.from({ length: Math.min(progress.gridMax, MAX_GRID_CELLS) }, (_, index) => index + 1).map((number) => {
              const volume = volumeByNumber.get(number);
              const state = volume?.state ?? "missing";
              const isNext = nextNumber === number;
              return (
                <div
                  key={number}
                  title={volume ? volume.title : `Tome ${number}, pas possédé`}
                  className={`flex aspect-square flex-col items-center justify-center rounded-lg border text-sm font-bold tabular-nums ${CELL_STATES[state]} ${isNext ? "ring-2 ring-cyan" : ""}`}
                >
                  {number}
                  <span className="text-[9px] font-semibold uppercase leading-none opacity-80">
                    {state === "read" ? "lu" : state === "pile" ? "pile" : ""}
                  </span>
                </div>
              );
            })}
            {unnumbered.map((volume) => (
              <button
                key={volume.bookId}
                type="button"
                disabled={isPending}
                onClick={() => {
                  setNumberingError(null);
                  setNumbering(volume);
                }}
                aria-label={`« ${volume.title} » sans numéro — numéroter`}
                className="flex aspect-square flex-col items-center justify-center rounded-lg border border-dashed border-magenta/50 bg-magenta/10 text-sm font-bold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan disabled:opacity-50"
              >
                ?<span className="text-[9px] font-semibold uppercase leading-none opacity-80">n° ?</span>
              </button>
            ))}
            {progress.isOngoing && (
              <div aria-hidden className="flex aspect-square items-center justify-center rounded-lg border border-line bg-card2 text-ink3">
                …
              </div>
            )}
          </div>
          {progress.gridMax > MAX_GRID_CELLS && (
            <p className="text-xs text-ink3">
              … et {progress.gridMax - MAX_GRID_CELLS} tomes de plus — les compteurs et le tome suivant les comptent.
            </p>
          )}
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink3">
            <span><span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-sm bg-green" />lu</span>
            <span><span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber" />dans la pile</span>
            <span><span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-sm border border-dashed border-line" />pas possédé</span>
            {unnumbered.length > 0 && <span><span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-sm bg-magenta/60" />sans numéro</span>}
          </p>
        </section>

        {declared !== null && !isDeclaring && (
          <div className="flex items-center justify-between gap-3 rounded-card border border-line bg-card p-3 text-sm">
            <span className="text-ink2">{declared}</span>
            <button
              type="button"
              onClick={() => setIsDeclaring(true)}
              disabled={isPending}
              className="flex-none text-sm text-ink2 underline underline-offset-2 disabled:opacity-50"
            >
              Modifier
            </button>
          </div>
        )}
        {topKnown !== null && progress.totalVolumes !== null && topKnown.value > progress.totalVolumes && !isDeclaring && (
          <div className="flex items-center justify-between gap-3 rounded-card border border-cyan/30 bg-cyan/10 p-3 text-sm text-ink">
            <span>{knownMaxExceedsLabel(topKnown)}</span>
            <Button type="button" variant="ghost" disabled={isPending} onClick={() => onDeclareTotal(topKnown.value)}>
              Mettre à jour
            </Button>
          </div>
        )}
        {(declared === null || isDeclaring) && (
          <DeclareTotalBlock
            progress={progress}
            isPending={isPending}
            onDeclareTotal={onDeclareTotal}
            onDeclareOngoing={onDeclareOngoing}
            onCancel={declared !== null ? () => setIsDeclaring(false) : undefined}
          />
        )}
      </div>

      {numbering !== null && (
        <VolumeNumpadSheet
          bookTitle={numbering.title}
          takenNumbers={takenNumbers}
          gridMax={progress.gridMax}
          isPending={isPending}
          errorMessage={numberingError}
          onClose={() => setNumbering(null)}
          onPick={async (rawNumber) => {
            setNumberingError(null);
            const ok = await onNumberVolume(numbering.bookId, rawNumber);
            if (ok) setNumbering(null);
            else setNumberingError("Ce n'est pas un numéro de tome, ou l'enregistrement a échoué.");
          }}
        />
      )}
    </div>
  );
}
