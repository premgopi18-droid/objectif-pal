"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorAlert } from "@/components/error-alert";
import { CategoryDrawer } from "./category-drawer";
import { BarcodeScanner } from "./barcode-scanner";
import { recordOwnership, recordOwnedPastReading, type BookInput } from "@/lib/books/actions";
import { addToScanInbox } from "@/lib/books/scan-inbox-actions";
import { NETWORK_ERROR_MESSAGE } from "@/lib/books/errors";
import { CATEGORY_LABELS } from "@/lib/books/categories";
import { localToday } from "@/lib/dates";
import { isBooklandCode } from "@/lib/resolution/barcode-router";
import { isCategoryGuessed } from "@/lib/resolution/guess-category";
import type { ResolvedBook, ScanLookupResult } from "@/lib/resolution/types";
import type { BookCategory } from "@/lib/scoring/types";
import type { ScanIntent } from "@/lib/books/scan-inbox";
import type { Json } from "@/lib/supabase/database.types";

/**
 * Le scan d'étagère en rafale (#101 lot C, specs §4.13).
 *
 * **La chaîne ne s'arrête jamais.** Scanner une étagère, c'est 50 scans
 * d'affilée : s'arrêter sur chaque livre introuvable, c'est abandonner au
 * dixième. Trois principes en découlent :
 *
 *  1. **la capture est découplée de la résolution** — le scan enregistre le
 *     code et rend la main tout de suite ; la cascade tourne en arrière-plan ;
 *  2. **aucun scan n'est perdu** — tout ce qui ne se résout pas part dans la
 *     boîte de finition avec son intention, jamais dans le vide ;
 *  3. **l'intention est décidée une fois**, pour toute la session — c'est le
 *     geste réel : on range une étagère de possédés, puis une de déjà-lus.
 *
 * Aucun de ces gestes ne touche au barème (§4.13).
 */

/** Ce qu'une ligne de la liste de session raconte. */
type BurstItem = {
  key: number;
  code: string | null;
  /**
   * `resolving` : la cascade tourne, la main est déjà rendue.
   * `added` : le livre existe. `inbox` : capté, à finaliser.
   * `duplicate` : déjà là — on continue, ce n'est pas une erreur.
   */
  status: "resolving" | "added" | "inbox" | "duplicate" | "error";
  title: string | null;
  category: BookCategory | null;
  /** Vrai quand la catégorie est une DEVINETTE (§5.5) — c'est là qu'on veut l'œil. */
  categoryGuessed: boolean;
  bookId: string | null;
  message: string | null;
};

const STATUS_BADGE = {
  resolving: { label: "…", state: "idle" as const },
  added: { label: "Ajouté", state: "done" as const },
  inbox: { label: "À compléter", state: "pile" as const },
  duplicate: { label: "Déjà là", state: "idle" as const },
  error: { label: "À compléter", state: "pile" as const },
};

const INTENT_OPTIONS: { value: ScanIntent; label: string }[] = [
  { value: "own", label: "Je possède" },
  { value: "own_read", label: "Déjà lu" },
];

/** Un livre résolu → l'entrée d'écriture, catégorie proposée acceptée telle quelle. */
const resolvedToInput = (book: ResolvedBook, scannedCode: string | null): BookInput => ({
  title: book.title ?? book.seriesName ?? "Sans titre",
  seriesName: book.seriesName,
  issueNumber: book.issueNumber,
  authors: book.authors,
  publisher: book.publisher,
  pageCount: book.pageCount,
  coverUrl: book.coverUrl,
  category: book.suggestedCategory,
  barcodeRaw: scannedCode ?? book.barcode,
  barcodeType: book.barcodeType,
  isbn: book.isbn,
  metadataSource: book.source,
  metadataSourceId: book.sourceId,
});

export function BurstMode({ onExit, pendingInboxCount }: { onExit: () => void; pendingInboxCount: number }) {
  const [intent, setIntent] = useState<ScanIntent>("own");
  // L'étagère d'avant n'a pas de date connue : c'est le défaut, pas l'exception.
  const [dateKnown, setDateKnown] = useState(false);
  const [date, setDate] = useState(localToday());
  const [items, setItems] = useState<BurstItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ key: number; bookId: string; category: BookCategory } | null>(null);

  const nextKeyRef = useRef(0);
  // Les réglages dans une ref : la callback du scanner est mémoïsée (la
  // remplacer redémarrerait la caméra), elle ne doit donc pas capturer un état
  // périmé — on change d'intention en pleine session. Synchronisée dans un
  // effet : écrire une ref pendant le rendu casse le rendu concurrent.
  const settingsRef = useRef({ intent, dateKnown, date });
  useEffect(() => {
    settingsRef.current = { intent, dateKnown, date };
  }, [intent, dateKnown, date]);

  const patch = useCallback((key: number, changes: Partial<BurstItem>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...changes } : item)));
  }, []);

  const handleCode = useCallback(
    (code: string) => {
      const key = nextKeyRef.current++;
      const { intent: capturedIntent, dateKnown: capturedDateKnown, date: capturedDate } = settingsRef.current;
      const shelfDate = capturedDateKnown ? capturedDate : null;

      // La ligne apparaît AVANT toute requête : c'est ce qui rend la main
      // immédiatement et permet d'enchaîner. Tout le reste se met à jour après.
      setItems((current) => [
        { key, code, status: "resolving", title: null, category: null, categoryGuessed: false, bookId: null, message: null },
        ...current,
      ]);

      // Volontairement NON attendu : la chaîne continue pendant que ça tourne.
      void (async () => {
        /** Le filet : quoi qu'il arrive, le scan finit quelque part. */
        const capture = async (coverUrl: string | null, metadata: Json | null) => {
          const result = await addToScanInbox({
            barcodeRaw: code,
            // Le type se DÉDUIT du code (même règle que la saisie manuelle) :
            // sans lui, la finition ne saurait pas reconstituer l'ISBN, alors
            // que le code est là.
            barcodeType: isBooklandCode(code) ? "isbn" : "upc",
            coverUrl,
            resolvedMetadata: metadata,
            intent: capturedIntent,
            ownedSince: capturedIntent === "own" ? shelfDate : null,
            finishedAt: capturedIntent === "own_read" ? shelfDate : null,
          });
          if (!result.ok) {
            patch(key, { status: "error", message: result.error });
            return;
          }
          patch(key, {
            status: result.duplicate ? "duplicate" : "inbox",
            message: result.duplicate ? "Déjà dans la boîte de finition." : null,
          });
        };

        try {
          const response = await fetch(`/api/lookup/${encodeURIComponent(code)}`);
          if (!response.ok) {
            await capture(null, null);
            return;
          }
          const lookup = (await response.json()) as ScanLookupResult;

          // Un livre identifié — le cas nominal (~95 % en VF). On écrit tout de
          // suite, sans rien demander : l'intention est déjà connue.
          if (lookup.kind === "resolved" || lookup.kind === "in-library") {
            const book = lookup.book;
            const input = resolvedToInput(book, lookup.kind === "in-library" ? null : code);
            // « Déjà lu » sur une étagère veut dire possédé ET lu : les deux
            // faits, en un appel (§4.13). Sans la possession, le livre serait
            // indiscernable d'un emprunt de médiathèque.
            const written =
              capturedIntent === "own_read"
                ? await recordOwnedPastReading(input, shelfDate)
                : await recordOwnership(input, shelfDate);
            if (!written.ok) {
              // « Déjà dans ta bibliothèque » n'est pas un échec en rafale :
              // c'est le livre qu'on a déjà rangé. On continue, sans bruit.
              patch(key, {
                status: "duplicate",
                title: book.title ?? book.seriesName,
                message: written.error,
              });
              return;
            }
            patch(key, {
              status: "added",
              title: book.title ?? book.seriesName,
              category: book.suggestedCategory,
              categoryGuessed: isCategoryGuessed(book.source),
              bookId: written.bookId,
            });
            return;
          }

          // Tout le reste demande une décision humaine — introuvable, choix de
          // numéro, « image oui, infos non » : ça part dans la boîte, avec ce
          // que la cascade a quand même trouvé pour pré-remplir la finition.
          const coverUrl = lookup.kind === "not-found" ? lookup.coverUrl : null;
          const metadata =
            lookup.kind === "pick-issue"
              ? { seriesName: lookup.seriesName, publisher: lookup.publisher }
              : null;
          await capture(coverUrl, metadata);
        } catch {
          // Réseau coupé, serveur injoignable : surtout ne rien perdre.
          try {
            await capture(null, null);
          } catch {
            patch(key, { status: "error", message: NETWORK_ERROR_MESSAGE });
          }
        }
      })();
    },
    [patch],
  );

  const addedCount = items.filter((item) => item.status === "added").length;
  const toCompleteCount = items.filter((item) => item.status === "inbox" || item.status === "error").length;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Scan d&apos;étagère</h1>
          <p className="mt-0.5 text-sm text-ink2">Enchaîne les livres — rien ne s&apos;arrête, rien ne se perd.</p>
        </div>
        <Button type="button" variant="ghost" onClick={onExit}>
          Terminer
        </Button>
      </div>

      {error && <ErrorAlert message={error} />}

      {/* L'intention vaut pour toute la session : on range une étagère de
          possédés, puis une de déjà-lus — pas un livre sur deux. */}
      <div className="flex flex-col gap-3 rounded-card border border-line bg-card p-3">
        <div role="group" aria-label="Ce que je fais de ces livres" className="flex gap-2">
          {INTENT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={intent === option.value}
              onClick={() => setIntent(option.value)}
              className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium ${
                intent === option.value ? "bg-cyan/15 text-ink ring-1 ring-cyan" : "bg-card2 text-ink2"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2.5 text-sm text-ink2">
          <input
            type="checkbox"
            checked={dateKnown}
            onChange={(event) => setDateKnown(event.target.checked)}
            className="size-4 rounded border-line bg-card2 accent-cyan"
          />
          Je connais la date
        </label>
        {dateKnown && (
          <input
            type="date"
            aria-label="Date"
            value={date}
            max={localToday()}
            onChange={(event) => setDate(event.target.value)}
            className="rounded-xl border border-line bg-card2 px-3 py-2 text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
          />
        )}
      </div>

      <BarcodeScanner onCode={handleCode} continuous />

      <p className="text-sm text-ink2" aria-live="polite">
        <strong className="text-ink">{addedCount}</strong> ajouté{addedCount > 1 ? "s" : ""}
        {toCompleteCount > 0 && ` · ${toCompleteCount} à compléter`}
      </p>

      {(toCompleteCount > 0 || pendingInboxCount > 0) && (
        <a
          href="/finition"
          className="rounded-card border border-amber/40 bg-amber/10 p-3 text-sm text-ink underline underline-offset-2"
        >
          {toCompleteCount + pendingInboxCount} livre{toCompleteCount + pendingInboxCount > 1 ? "s" : ""} à
          compléter — à faire quand tu veux, rien n&apos;est perdu.
        </a>
      )}

      {items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((item) => {
            const badge = STATUS_BADGE[item.status];
            return (
              <li key={item.key} className="flex items-center gap-3 rounded-card border border-line bg-card px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">{item.title ?? item.code ?? "Sans code"}</p>
                  {item.message && <p className="truncate text-xs text-ink3">{item.message}</p>}
                </div>

                {/* La catégorie se corrige ICI, sans interrompre le scan : une
                    puce, un tiroir partagé. Le « ? » ne s'affiche que sur les
                    devinettes (§5.5) — l'œil va où le doute est. */}
                {item.status === "added" && item.category !== null && item.bookId !== null && (
                  <button
                    type="button"
                    onClick={() =>
                      setEditing({ key: item.key, bookId: item.bookId!, category: item.category! })
                    }
                    className="shrink-0 rounded-full border border-line px-2.5 py-1 text-xs text-ink2"
                  >
                    {CATEGORY_LABELS[item.category]}
                    {item.categoryGuessed && <span className="ml-1 text-amber">?</span>}
                  </button>
                )}
                <Badge state={badge.state}>{badge.label}</Badge>
              </li>
            );
          })}
        </ul>
      )}

      {/* UN seul tiroir monté, recyclé pour toutes les lignes : c'est ce qui
          garde la liste légère même après 80 scans. */}
      <CategoryDrawer
        open={editing !== null}
        bookId={editing?.bookId ?? null}
        value={editing?.category ?? "bd"}
        onClose={() => setEditing(null)}
        onError={setError}
        onChanged={(category) => {
          if (editing) patch(editing.key, { category, categoryGuessed: false });
          setEditing(null);
        }}
      />
    </section>
  );
}
