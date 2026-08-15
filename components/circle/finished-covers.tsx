"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Toast } from "@/components/ui/toast";
import { CATEGORY_LABELS } from "@/lib/books/categories";
import { coverGridSlice } from "@/lib/circle/cover-grid";
import { formatMonthFrench } from "@/lib/dates";
import type { StoredFinishedReading } from "@/lib/scoring/closed-months";
import type { Month } from "@/lib/scoring/types";

/**
 * Les terminés du mois en COUVERTURES (#236, maquette interactive validée le
 * 16/08/2026) — la grille plafonnée-dépliable, et la feuille d'info du livre
 * au tap. Tout vient de la ligne d'agrégat servie : les métadonnées PUBLIQUES
 * du livre, jamais la note ni l'avis (ils n'y sont pas). L'ISBN se copie en
 * un tap — le pont voulu vers l'extérieur (librairie, catalogue), sans lien
 * sortant.
 *
 * La feuille suit le patron maison (category-drawer) : fond cliquable,
 * dialog, fermetures fond/croix/Échap. Les animations (sheet-in/fade-in,
 * globals.css) sont neutralisées par le kill-switch prefers-reduced-motion.
 */

type FinishedCoversProps = {
  readings: StoredFinishedReading[];
  /** Le pseudo du propriétaire du bilan — la ligne de contexte de la feuille. */
  ownerDisplayName: string;
  month: Month;
};

export function FinishedCovers({ readings, ownerDisplayName, month }: FinishedCoversProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [selected, setSelected] = useState<StoredFinishedReading | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const { visible, hidden } = coverGridSlice(readings.length, isExpanded);

  // Échap ferme la feuille ; le focus part sur la croix à l'ouverture (dialog).
  useEffect(() => {
    if (selected === null) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selected]);

  async function copyIsbn(isbn: string) {
    // Le presse-papiers peut rejeter (permission, focus) : jamais d'échec
    // muet — l'ISBN est affiché en texte sélectionnable juste à côté.
    try {
      await navigator.clipboard.writeText(isbn);
      setToastMessage("ISBN copié ✓");
    } catch {
      setToastMessage("Copie impossible — sélectionne l'ISBN affiché");
    }
  }

  return (
    <div className="border-t border-line pt-2.5">
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-ink3">
        Terminés ce mois-là · <span className="tabular-nums">{readings.length}</span>
      </p>
      <div className="mt-2 grid grid-cols-5 gap-1.5">
        {readings.slice(0, visible).map((reading) => (
          <button
            key={reading.readingId}
            type="button"
            onClick={() => setSelected(reading)}
            aria-label={reading.title}
            className="overflow-hidden rounded-lg border border-line bg-card2 p-0 transition active:scale-[0.94] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
          >
            {reading.coverUrl !== null ? (
              <Image
                src={reading.coverUrl}
                alt=""
                width={64}
                height={96}
                unoptimized
                loading="lazy"
                className="aspect-[2/3] w-full object-cover"
              />
            ) : (
              // Le repli sans couverture : le titre, jamais un trou (#236).
              <span className="flex aspect-[2/3] w-full items-center justify-center p-1 text-center text-[9px] font-bold leading-tight text-ink2">
                <span className="line-clamp-4">{reading.title}</span>
              </span>
            )}
          </button>
        ))}
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            aria-label={`Afficher les ${hidden} autres lectures du mois`}
            className="grid aspect-[2/3] place-items-center rounded-lg border border-line bg-card2 text-sm font-black tabular-nums text-ink2 transition active:scale-[0.94] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
          >
            +{hidden}
          </button>
        )}
      </div>

      {selected !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={selected.title}
          className="animate-[fade-in_240ms_ease] fixed inset-0 z-50 flex items-end bg-black/60"
          onClick={() => setSelected(null)}
        >
          <div
            className="animate-[sheet-in_280ms_cubic-bezier(0.32,0.72,0.24,1)] relative w-full rounded-t-2xl border-t border-line bg-card p-4 pb-8"
            onClick={(event) => event.stopPropagation()}
          >
            <div aria-hidden className="mx-auto h-1 w-10 rounded-full bg-line" />
            <button
              ref={closeButtonRef}
              type="button"
              onClick={() => setSelected(null)}
              aria-label="Fermer"
              className="absolute right-3 top-3 grid size-8 place-items-center rounded-full border border-line bg-card2 text-sm font-bold text-ink2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
            >
              ✕
            </button>
            <div className="mt-3 flex gap-4">
              {selected.coverUrl !== null ? (
                <Image
                  src={selected.coverUrl}
                  alt=""
                  width={104}
                  height={156}
                  unoptimized
                  className="aspect-[2/3] w-[104px] shrink-0 rounded-xl border border-line object-cover"
                />
              ) : (
                <span className="flex aspect-[2/3] w-[104px] shrink-0 items-center justify-center rounded-xl border border-line bg-card2 p-2 text-center text-xs font-bold leading-tight text-ink2">
                  {selected.title}
                </span>
              )}
              <div className="flex min-w-0 flex-col gap-1.5">
                <p className="text-base font-black leading-snug">{selected.title}</p>
                {selected.seriesName !== null && selected.seriesName !== selected.title && (
                  <p className="text-sm text-ink2">Série : {selected.seriesName}</p>
                )}
                {selected.authors !== null && <p className="text-sm italic text-ink2">{selected.authors}</p>}
                <div className="mt-0.5 flex flex-wrap gap-1.5">
                  {selected.category !== null && (
                    <span className="rounded-full bg-cyan/15 px-2.5 py-1 text-[11.5px] font-bold text-cyan">
                      {CATEGORY_LABELS[selected.category]}
                    </span>
                  )}
                  {selected.publisher !== null && (
                    <span className="rounded-full border border-line bg-card2 px-2.5 py-1 text-[11.5px] font-bold text-ink2">
                      {selected.publisher}
                    </span>
                  )}
                  {selected.pageCount !== null && (
                    <span className="rounded-full border border-line bg-card2 px-2.5 py-1 text-[11.5px] font-bold tabular-nums text-ink2">
                      {selected.pageCount} p.
                    </span>
                  )}
                </div>
                {selected.isbn !== null && <IsbnRow isbn={selected.isbn} onCopy={copyIsbn} />}
              </div>
            </div>
            <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-ink3">
              Terminé par <span className="font-bold text-ink2">{ownerDisplayName}</span> en{" "}
              <span className="capitalize">{formatMonthFrench(month)}</span>
            </p>
          </div>
        </div>
      )}

      <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </div>
  );
}

/** La ligne ISBN — extraite pour que le rétrécissement `isbn: string` traverse proprement (review #237). */
function IsbnRow({ isbn, onCopy }: { isbn: string; onCopy: (isbn: string) => void }) {
  return (
    <div className="mt-1 flex items-center gap-2 text-sm">
      <span className="text-ink3">ISBN</span>
      <span className="select-all font-bold tabular-nums text-ink2">{isbn}</span>
      <button
        type="button"
        onClick={() => onCopy(isbn)}
        className="rounded-lg border border-line bg-card2 px-2 py-1 text-xs font-bold text-ink transition active:scale-[0.95] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
      >
        📋 Copier
      </button>
    </div>
  );
}
