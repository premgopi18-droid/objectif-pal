"use client";

import { useState } from "react";
import { BookCover } from "@/components/book-cover";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorAlert } from "@/components/error-alert";
import { ManualEntryForm } from "@/components/scan/manual-entry-form";
import { completeScanInboxItem, dismissScanInboxItem } from "@/lib/books/scan-inbox-actions";
import { NETWORK_ERROR_MESSAGE } from "@/lib/books/errors";
import { INTENT_LABELS, toScanInboxDraft, type ScanInboxItem } from "@/lib/books/scan-inbox";
import type { BookInput } from "@/lib/books/actions";

/**
 * La boîte de finition (#101 lot C, specs §4.13) — le corollaire de « la
 * rafale ne s'arrête jamais ».
 *
 * On scanne à la cave, on complète sur le canapé : chaque élément garde son
 * code, sa couverture ou sa photo, ce que la cascade avait trouvé de partiel,
 * et surtout **l'intention déclarée au scan**. Elle n'est donc JAMAIS
 * redemandée — l'utilisateur a déjà répondu, une fois.
 */
export function FinitionView({ items }: { items: ScanInboxItem[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Les éléments traités dans cette session — retirés de la liste sans recharger. */
  const [handledIds, setHandledIds] = useState<string[]>([]);

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

      {error && <ErrorAlert message={error} />}

      <ul className="flex flex-col gap-3">
        {visible.map((item) => {
          const draft = toScanInboxDraft(item);
          const isOpen = openId === item.id;
          const isBusy = busyId === item.id;

          return (
            <li key={item.id}>
              <Card className="flex flex-col gap-3">
                <div className="flex gap-3">
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

                {isOpen ? (
                  <ManualEntryForm
                    scannedCode={draft.barcodeRaw}
                    suggestedCoverUrl={draft.coverUrl}
                    initialValues={draft}
                    submitLabel={item.intent === "own_read" ? "Marquer comme lu" : "Ajouter à ma bibliothèque"}
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
            </li>
          );
        })}
      </ul>
    </div>
  );
}
