"use client";

import { useState } from "react";
import { BookCover } from "@/components/book-cover";
import { CategoryPicker } from "@/components/category-picker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { displayableIssueNumber, formatBookSubtitle } from "@/lib/books/format";
import { localToday } from "@/lib/dates";
import { ctaLabel, defaultDateUnknown, submittedDate, SHEET_INTENT_ORDER, SHEET_INTENTS, type SheetIntent } from "./sheet-intents";
import type { BookInput } from "@/lib/books/actions";
import type { ResolvedBook } from "@/lib/resolution/types";
import type { BookCategory } from "@/lib/scoring/types";

/**
 * La feuille d'actions — specs §4.1, refonte #165 : le scan a résolu un livre,
 * l'app DEMANDE l'intention via un sélecteur à cinq cartes radio (« Je
 * commence » pré-sélectionné) et UN bouton de validation qui répète toujours
 * l'intention choisie. La fiche se vérifie d'abord (titre, catégorie, date —
 * au-dessus des choix), le geste se décide ensuite. Les cinq gestes sont des
 * égaux : plus de cases à effet de bord, plus de bouton au sens variable.
 */

/** L'intention pré-sélectionnée — le geste quotidien à un tap (#165). L'état
 * initial de la case « Je ne sais plus quand » en dérive (#254) : une seule
 * source, les deux ne peuvent pas diverger. */
const INITIAL_INTENT: SheetIntent = "start";

/** Les champs de la feuille, stylés une fois sur les tokens (§2). */
const INPUT_CLASS =
  "w-full rounded-xl border border-line bg-card2 px-3 py-2.5 text-ink placeholder:text-ink3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan";

type BookActionSheetProps = {
  book: ResolvedBook;
  /** Le code réellement scanné — prioritaire sur celui connu de la source. */
  scannedCode: string | null;
  /**
   * Le livre a déjà été TERMINÉ (specs §4.2) : la question « tu le relis ? »
   * est posée par l'écran, le CTA de « Je commence » devient la réponse
   * explicite (« Oui, je le relis ») — les autres intentions ne changent pas.
   */
  isRereadingPrompt?: boolean;
  onStartReading: (input: BookInput, date: string) => void;
  onPurchase: (input: BookInput, date: string) => void;
  /** « Je le possède » — l'étagère d'avant l'app (#101). Date d'acquisition facultative. */
  onOwn: (input: BookInput, ownedSince: string | null) => void;
  /**
   * « Lu — emprunt » (#113) : lecture seule, aucune possession — le livre de
   * médiathèque, le prêt d'un ami.
   */
  onPastReading: (input: BookInput, finishedAt: string | null) => void;
  /** « Possédé, déjà lu » (#113, §4.13) : les deux faits — aligné sur la rafale. */
  onOwnedPastReading: (input: BookInput, finishedAt: string | null) => void;
  onCancel: () => void;
  isSubmitting: boolean;
};

export function BookActionSheet({
  book,
  scannedCode,
  isRereadingPrompt = false,
  onStartReading,
  onPurchase,
  onOwn,
  onPastReading,
  onOwnedPastReading,
  onCancel,
  isSubmitting,
}: BookActionSheetProps) {
  // Sans numéro affichable (dont le « [nn] » GCD, issue #58) : la série seule —
  // plus jamais de « #[nn] » ni de « #? » qui partirait en base dans le titre.
  const issueNumber = displayableIssueNumber(book.issueNumber);
  const defaultTitle = book.title ?? (book.seriesName ? (issueNumber ? `${book.seriesName} #${issueNumber}` : book.seriesName) : "");
  const [title, setTitle] = useState(defaultTitle);
  const [category, setCategory] = useState<BookCategory>(book.suggestedCategory);
  const [date, setDate] = useState(localToday());
  // L'étagère d'avant l'app n'a pas de date connue (#101). On ne l'invente pas :
  // sans date, le livre compte dans le stock de la PAL sans peser sur les flux
  // du mois, et une lecture passée ne crédite aucun bilan. D'où le défaut
  // (#254) : sur les gestes à date facultative, « Je ne sais plus quand » est
  // PRÉ-COCHÉ — le champ pré-rempli à aujourd'hui datait silencieusement tout
  // un inventaire au jour du scan.
  const [dateUnknown, setDateUnknown] = useState(defaultDateUnknown(INITIAL_INTENT));
  const [intent, setIntent] = useState<SheetIntent>(INITIAL_INTENT);
  const config = SHEET_INTENTS[intent];

  // Changer d'intention remet « Je ne sais plus quand » au défaut du geste
  // choisi (#254) : pas d'état caché reporté d'un geste à l'autre (#165) —
  // c'était LA friction de l'ancienne feuille.
  const selectIntent = (next: SheetIntent) => {
    setIntent(next);
    setDateUnknown(defaultDateUnknown(next));
  };

  // Un champ date vidé à la main ne bloque QUE les gestes à date obligatoire
  // (avec le message de la ligne réservée) : pour l'étagère d'avant, un champ
  // vide vaut « date inconnue » — soumis nul, comme la case (review #166).
  const dateMissing = !date && !config.dateOptional;

  const buildInput = (): BookInput => ({
    title,
    seriesName: book.seriesName,
    issueNumber: book.issueNumber,
    authors: book.authors,
    publisher: book.publisher,
    pageCount: book.pageCount,
    coverUrl: book.coverUrl,
    category,
    barcodeRaw: scannedCode ?? book.barcode,
    barcodeType: book.barcodeType,
    isbn: book.isbn,
    metadataSource: book.source,
    metadataSourceId: book.sourceId,
  });

  /** L'intention choisie → l'action serveur existante. Switch exhaustif : une 6ᵉ intention sans branche casse le build. */
  const submit = () => {
    const input = buildInput();
    switch (intent) {
      case "start":
        onStartReading(input, date);
        break;
      case "purchase":
        onPurchase(input, date);
        break;
      case "own":
        onOwn(input, submittedDate(intent, date, dateUnknown));
        break;
      case "own_read":
        onOwnedPastReading(input, submittedDate(intent, date, dateUnknown));
        break;
      case "read":
        onPastReading(input, submittedDate(intent, date, dateUnknown));
        break;
      default:
        intent satisfies never;
    }
  };

  return (
    <section className="flex flex-col gap-5">
      <Card className="flex gap-4">
        <BookCover coverUrl={book.coverUrl} size="large" title={title} />
        <div className="min-w-0 flex-1">
          <input
            aria-label="Titre"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={`${INPUT_CLASS} font-semibold`}
          />
          <p className="mt-1.5 truncate text-sm text-ink2">
            {formatBookSubtitle(book.seriesName, book.issueNumber, book.publisher)}
          </p>
          {book.pageCount !== null && <p className="text-sm text-ink2">{book.pageCount} pages</p>}
          {book.authors && <p className="truncate text-sm text-ink2">{book.authors}</p>}
          {(scannedCode ?? book.barcode) && (
            <p className="mt-1 font-mono text-xs text-ink3">
              {scannedCode ?? book.barcode}
              {scannedCode && ` · ${scannedCode.length} chiffres`}
            </p>
          )}
        </div>
      </Card>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink2">Catégorie (proposée — corrige si besoin)</legend>
        <CategoryPicker value={category} onChange={setCategory} />
      </fieldset>

      {/* La date au-dessus des choix (#165) : le libellé suit l'intention — le
          champ « à quatre sens muets » n'existe plus. */}
      <div className="flex flex-col gap-3">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="font-medium text-ink2">
            {config.dateLabel}
            {config.dateOptional && <span className="font-normal text-ink3"> (facultatif)</span>}
          </span>
          <input
            type="date"
            value={date}
            // Pas de date future : on borne la SÉLECTION côté client (le fuseau local, pas UTC).
            max={localToday()}
            disabled={config.dateOptional && dateUnknown}
            onChange={(event) => setDate(event.target.value)}
            className="rounded-xl border border-line bg-card2 px-3 py-2 text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan disabled:opacity-40"
          />
        </label>

        {/* La ligne reste TOUJOURS dans le flux : changer d'intention ne fait
            jamais bouger la liste des choix sous le doigt (#165). Elle porte la
            case (date facultative) OU, sur un geste à date obligatoire dont le
            champ a été vidé, la raison du CTA bloqué (review #166) — plus
            jamais de bouton grisé sans cause visible. */}
        {config.dateOptional ? (
          <label className="flex items-center gap-2.5 text-sm text-ink2">
            <input
              type="checkbox"
              checked={dateUnknown}
              onChange={(event) => setDateUnknown(event.target.checked)}
              className="size-4 rounded border-line bg-card2 accent-cyan"
            />
            Je ne sais plus quand
          </label>
        ) : (
          <p className={`text-sm text-amber ${dateMissing ? "" : "invisible"}`}>Il faut une date pour ce geste.</p>
        )}
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink2">On en fait quoi ?</legend>
        <div className="flex flex-col gap-2">
          {SHEET_INTENT_ORDER.map((candidate) => {
            const option = SHEET_INTENTS[candidate];
            const active = intent === candidate;
            return (
              <label
                key={candidate}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-cyan ${
                  active ? "border-cyan bg-card2" : "border-line bg-card"
                }`}
              >
                <input
                  type="radio"
                  name="sheet-intent"
                  value={candidate}
                  checked={active}
                  onChange={() => selectIntent(candidate)}
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

      {/* Chaque intention a sa note. min-h-15 = 3 lignes de text-sm : sur un
          écran ≤ 360 px les notes wrappent sur 3 lignes (review #166) — la
          hauteur ne saute pas en changeant d'intention. */}
      <p className="min-h-15 text-sm text-ink3">{config.note}</p>

      <div className="flex flex-col gap-3">
        {/* UN bouton de validation, au dégradé signature (CTA §2) — son libellé
            répète l'intention : impossible de valider autre chose que ce qu'on croit. */}
        <Button
          type="button"
          variant="grad"
          block
          disabled={isSubmitting || !title.trim() || dateMissing}
          onClick={submit}
        >
          {ctaLabel(intent, isRereadingPrompt)}
        </Button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="py-2 text-sm text-ink3 disabled:opacity-50"
        >
          Annuler
        </button>
      </div>
    </section>
  );
}
