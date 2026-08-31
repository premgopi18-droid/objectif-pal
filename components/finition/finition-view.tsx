"use client";

import { useState } from "react";
import { BookCover } from "@/components/book-cover";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Toast } from "@/components/ui/toast";
import { ErrorAlert } from "@/components/error-alert";
import { ManualEntryForm } from "@/components/scan/manual-entry-form";
import { completeScanInboxItem, dismissScanInboxItem, dismissScanInboxItems } from "@/lib/books/scan-inbox-actions";
import { NETWORK_ERROR_MESSAGE } from "@/lib/books/errors";
import {
  formatDismissOutcome,
  INTENT_LABELS,
  toScanInboxDraft,
  type ScanInboxItem,
  type ScanIntent,
} from "@/lib/books/scan-inbox";
import type { BookInput } from "@/lib/books/actions";

/**
 * Le bouton de finalisation, par intention — exhaustif par construction
 * (`Record<ScanIntent, …>`) : une quatrième intention sans libellé casserait
 * le build, comme pour `INTENT_LABELS` (review #115).
 */
const SUBMIT_LABELS: Record<ScanIntent, string> = {
  own: "Ajouter à ma bibliothèque",
  own_read: "Marquer comme lu",
  read: "Marquer comme lu (emprunt)",
  purchase: "Enregistrer l'achat (−1)",
};

/**
 * La boîte de finition (#101 lot C, specs §4.13) — le corollaire de « la
 * rafale ne s'arrête jamais ».
 *
 * On scanne à la cave, on complète sur le canapé : chaque élément garde son
 * code, sa couverture ou sa photo, ce que la cascade avait trouvé de partiel,
 * et surtout **l'intention déclarée au scan**. Elle n'est donc JAMAIS
 * redemandée — l'utilisateur a déjà répondu, une fois.
 *
 * L'ÉCART GROUPÉ (#258) : même patron de sélection que la Pile (#256) — cases
 * sur les cartes, barre d'actions au-dessus de la nav — pour balayer d'un coup
 * les scans ratés d'une rafale. Le « Compléter », lui, reste unitaire : chaque
 * fiche exige des métadonnées propres.
 */
export function FinitionView({ items }: { items: ScanInboxItem[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Les éléments traités dans cette session — retirés de la liste sans recharger. */
  const [handledIds, setHandledIds] = useState<string[]>([]);

  // Le mode sélection (#258) — la sélection se vide en sortant du mode.
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [isBulkBusy, setIsBulkBusy] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const visible = items.filter((item) => !handledIds.includes(item.id));

  const run = async (itemId: string, action: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    setBusyId(itemId);
    try {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "Le geste a échoué.");
        return;
      }
      setHandledIds((current) => [...current, itemId]);
      setOpenId(null);
    } catch {
      // Serveur injoignable : la promesse de la Server Action rejette.
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setBusyId(null);
    }
  };

  function exitSelection() {
    setIsSelecting(false);
    setSelectedIds(new Set());
  }

  function enterSelection() {
    // Un formulaire ouvert n'a rien à faire en mode sélection : on le replie.
    setOpenId(null);
    setIsSelecting(true);
  }

  function toggleSelection(itemId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  async function dismissSelection() {
    setError(null);
    setIsBulkBusy(true);
    const ids = [...selectedIds];
    try {
      const result = await dismissScanInboxItems(ids);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Écartés OU déjà traités ailleurs : dans les deux cas, ces lignes n'ont
      // plus rien à faire à l'écran — on les masque et on annonce le compte.
      setHandledIds((current) => [...current, ...ids]);
      setToastMessage(formatDismissOutcome(ids.length, result.dismissed).message);
      exitSelection();
    } catch {
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setIsBulkBusy(false);
    }
  }

  if (visible.length === 0) {
    return (
      <p className="mt-6 text-sm text-ink2">
        Rien à compléter — tous tes scans sont allés au bout. 🎉
      </p>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <p className="text-sm text-ink2">
        {visible.length} livre{visible.length > 1 ? "s" : ""} scanné{visible.length > 1 ? "s" : ""} que
        l&apos;app n&apos;a pas su identifier. Complète ce qu&apos;il manque — l&apos;intention que tu avais
        choisie au scan est conservée.
      </p>

      {visible.length > 1 && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            aria-pressed={isSelecting}
            disabled={isBulkBusy}
            onClick={() => (isSelecting ? exitSelection() : enterSelection())}
          >
            {isSelecting ? "Annuler" : "Sélectionner"}
          </Button>
        </div>
      )}

      {error && <ErrorAlert message={error} />}

      <ul className={`flex flex-col gap-3 ${isSelecting ? "pb-36" : ""}`}>
        {visible.map((item) => {
          const draft = toScanInboxDraft(item);
          const isOpen = openId === item.id;
          const isBusy = busyId === item.id;
          const isSelected = selectedIds.has(item.id);

          const header = (
            <div className="flex gap-3">
              {isSelecting && (
                <span
                  aria-hidden
                  className={`flex size-6 shrink-0 self-center items-center justify-center rounded-lg border-2 text-sm font-black ${
                    isSelected ? "border-cyan bg-cyan text-bg0" : "border-ink3 text-transparent"
                  }`}
                >
                  ✓
                </span>
              )}
              <BookCover coverUrl={draft.coverUrl} size="small" title={draft.title || "Livre à compléter"} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">
                  {draft.title || "Livre à identifier"}
                </p>
                <p className="mt-0.5 text-xs text-ink3">{INTENT_LABELS[item.intent]}</p>
                {draft.barcodeRaw !== null ? (
                  <p className="mt-1 font-mono text-xs text-ink3">{draft.barcodeRaw}</p>
                ) : (
                  <p className="mt-1 text-xs text-ink3">Sans code-barres — identifié par la photo</p>
                )}
              </div>
            </div>
          );

          return (
            <li key={item.id}>
              {isSelecting ? (
                // La carte ENTIÈRE devient la case (#258, patron #256) : les
                // gestes s'effacent, un tap = cocher. Ring, jamais une couleur
                // de bordure (règle #242).
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isSelected}
                  disabled={isBulkBusy}
                  onClick={() => toggleSelection(item.id)}
                  className={`w-full rounded-card text-left transition active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan disabled:opacity-50 ${
                    isSelected ? "ring-2 ring-cyan" : ""
                  }`}
                >
                  <Card className="flex flex-col gap-3">{header}</Card>
                </button>
              ) : (
                <Card className="flex flex-col gap-3">
                  {header}

                  {isOpen ? (
                    <ManualEntryForm
                      scannedCode={draft.barcodeRaw}
                      suggestedCoverUrl={draft.coverUrl}
                      initialValues={draft}
                      // Le libellé suit l'INTENTION, comme l'action (review #115) :
                      // un emprunt ne doit jamais afficher « Ajouter à ma
                      // bibliothèque » — c'est la possession que l'intention refuse.
                      submitLabel={SUBMIT_LABELS[item.intent]}
                      hideHeading
                      isSubmitting={isBusy}
                      onSubmit={(input: BookInput) => {
                        void run(item.id, () => completeScanInboxItem(item.id, input));
                      }}
                      onCancel={() => setOpenId(null)}
                    />
                  ) : (
                    <div className="flex items-center gap-3">
                      <Button type="button" variant="grad" disabled={isBusy} onClick={() => setOpenId(item.id)}>
                        Compléter
                      </Button>
                      {/* Écarter : scan raté, livre de quelqu'un d'autre. Rien
                          n'est effacé en base (§7), la ligne est juste masquée. */}
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void run(item.id, () => dismissScanInboxItem(item.id))}
                        className="ml-auto text-sm text-ink3 underline underline-offset-2 disabled:opacity-40"
                      >
                        Écarter
                      </button>
                    </div>
                  )}
                </Card>
              )}
            </li>
          );
        })}
      </ul>

      {/* La barre d'actions du lot — même étage que celle de la Pile (#256). */}
      {isSelecting && (
        <div className="fixed inset-x-0 bottom-24 z-20 px-4">
          <div className="shadow-float mx-auto flex max-w-md flex-col gap-2.5 rounded-card border border-line bg-card2 p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-ink">
                <span className="tabular-nums text-cyan">{selectedIds.size}</span> élément
                {selectedIds.size > 1 ? "s" : ""} sélectionné{selectedIds.size > 1 ? "s" : ""}
              </p>
              <button
                type="button"
                onClick={exitSelection}
                disabled={isBulkBusy}
                className="text-sm text-ink3 underline underline-offset-2 disabled:opacity-40"
              >
                Annuler
              </button>
            </div>
            <Button
              type="button"
              variant="danger"
              block
              disabled={selectedIds.size === 0 || isBulkBusy}
              onClick={() => void dismissSelection()}
            >
              Écarter la sélection
            </Button>
          </div>
        </div>
      )}

      <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </div>
  );
}
