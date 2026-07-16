"use client";

import { useCallback, useRef, useState } from "react";
import { ErrorAlert } from "@/components/error-alert";
import { startReading, recordPurchase, type BookInput, type ScanActionResult } from "@/lib/books/actions";
import { NETWORK_ERROR_MESSAGE } from "@/lib/books/errors";
import { SCORING_SCALE } from "@/lib/scoring/scale";
import type { IssueCandidate, ResolvedBook, ScanLookupResult, SeriesCandidate } from "@/lib/resolution/types";
import { BarcodeScanner } from "./barcode-scanner";
import { BookActionSheet } from "./book-action-sheet";
import { ManualEntryForm } from "./manual-entry-form";

/**
 * L'écran de scan — specs §5.3, dégradation douce : code complet = zéro
 * question, préfixe net = un tap (« quel numéro ? »), préfixe partagé = deux
 * taps, introuvable = saisie manuelle. Jamais d'échec sec.
 */

type ScanState =
  | { step: "scan"; notice?: string }
  | { step: "loading"; code: string }
  | { step: "sheet"; book: ResolvedBook; scannedCode: string | null; error?: string }
  | { step: "pick-issue"; seriesName: string; issues: IssueCandidate[]; scannedCode: string }
  | { step: "pick-series"; candidates: SeriesCandidate[]; scannedCode: string }
  | { step: "manual"; scannedCode: string | null }
  | { step: "done"; message: string; detail: string | null };

/** Le malus affiché vient du barème — jamais recopié en dur (CLAUDE.md). */
const PENALTY_POINTS = Math.abs(SCORING_SCALE.unreadPurchasePenalty);

/** Un BookInput saisi à la main, présenté comme un livre résolu pour réutiliser la feuille d'actions. */
const manualInputToBook = (input: BookInput): ResolvedBook => ({
  title: input.title,
  seriesName: input.seriesName,
  issueNumber: input.issueNumber,
  authors: input.authors,
  publisher: input.publisher,
  pageCount: input.pageCount,
  coverUrl: input.coverUrl,
  suggestedCategory: input.category,
  source: "manual",
  sourceId: null,
  barcodeType: input.barcodeType ?? "isbn",
  barcode: input.barcodeRaw,
  isbn: input.isbn,
});

export function ScanScreen() {
  const [state, setState] = useState<ScanState>({ step: "scan" });
  const [manualCode, setManualCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Le compteur de requêtes en vol : « Saisie manuelle » pendant la résolution
  // incrémente le compteur, et la réponse d'une requête périmée est IGNORÉE
  // quand elle revient — sinon elle écraserait la saisie en cours (course).
  const lookupIdRef = useRef(0);

  const lookup = useCallback(async (code: string) => {
    const requestId = ++lookupIdRef.current;
    setState({ step: "loading", code });
    try {
      const response = await fetch(`/api/lookup/${encodeURIComponent(code)}`);
      if (requestId !== lookupIdRef.current) return; // l'utilisateur est déjà passé en saisie manuelle
      if (response.status === 401) {
        setState({ step: "scan", notice: "Session expirée — reconnecte-toi." });
        return;
      }
      const result = (await response.json()) as ScanLookupResult;
      if (requestId !== lookupIdRef.current) return;

      if (result.kind === "resolved") {
        setState({ step: "sheet", book: result.book, scannedCode: code });
      } else if (result.kind === "pick-issue") {
        setState({ step: "pick-issue", seriesName: result.seriesName, issues: result.issues, scannedCode: code });
      } else if (result.kind === "pick-series") {
        setState({ step: "pick-series", candidates: result.candidates, scannedCode: code });
      } else {
        // not-found ou invalid : le filet ultime.
        setState({ step: "manual", scannedCode: result.kind === "not-found" ? code : null });
      }
    } catch {
      if (requestId !== lookupIdRef.current) return;
      setState({ step: "scan", notice: "La recherche a échoué — réessaie ou saisis à la main." });
    }
  }, []);

  const resolvePickedIssue = useCallback(async (gcdId: number, scannedCode: string) => {
    const requestId = ++lookupIdRef.current;
    setState({ step: "loading", code: scannedCode });
    try {
      const response = await fetch(`/api/lookup/gcd/${gcdId}`);
      const result = (await response.json()) as ScanLookupResult;
      if (requestId !== lookupIdRef.current) return; // requête périmée : la saisie manuelle a pris la main
      if (result.kind === "resolved") {
        // Le code scanné était un préfixe (la série entière) : ce n'est PAS le
        // code-barres de CE livre — on garde celui que GCD connaît pour l'issue.
        setState({ step: "sheet", book: result.book, scannedCode: null });
        return;
      }
      setState({ step: "manual", scannedCode });
    } catch {
      if (requestId !== lookupIdRef.current) return;
      setState({ step: "manual", scannedCode });
    }
  }, []);

  /** La porte de sortie pendant « Résolution en cours… » : on n'attend pas la cascade. */
  const skipToManualEntry = useCallback((scannedCode: string) => {
    lookupIdRef.current += 1; // périme la requête en vol : sa réponse sera ignorée
    setState({ step: "manual", scannedCode });
  }, []);

  async function performAction(
    action: (input: BookInput, date: string) => Promise<ScanActionResult>,
    input: BookInput,
    date: string,
    doneMessage: string,
  ) {
    setIsSubmitting(true);
    let result: ScanActionResult;
    try {
      result = await action(input, date);
    } catch {
      // La promesse d'une Server Action rejette quand le serveur est injoignable
      // (réseau coupé) : sans ce catch, le geste échouerait en silence.
      result = { ok: false, error: NETWORK_ERROR_MESSAGE };
    } finally {
      setIsSubmitting(false);
    }

    if (!result.ok) {
      setState((previous) => (previous.step === "sheet" ? { ...previous, error: result.error } : previous));
      return;
    }
    setState({
      step: "done",
      message: doneMessage,
      detail: result.isRereading
        ? "Tu l'avais déjà terminé — c'est reparti pour une relecture !"
        : result.bookAlreadyExisted
          ? "Ce livre était déjà dans ta bibliothèque."
          : null,
    });
  }

  if (state.step === "loading") {
    return (
      <div className="py-24 text-center">
        <p className="text-sm opacity-70">Résolution en cours…</p>
        <p className="mt-2 font-mono text-sm opacity-50">
          {state.code} · {state.code.length} chiffres
        </p>
        <button
          type="button"
          onClick={() => skipToManualEntry(state.code)}
          className="mt-6 rounded-full border border-foreground/20 px-5 py-2.5 text-sm font-medium"
        >
          Saisie manuelle
        </button>
      </div>
    );
  }

  if (state.step === "sheet") {
    return (
      <div className="flex flex-col gap-3">
        {state.error && <ErrorAlert message={state.error} />}
        <BookActionSheet
          book={state.book}
          scannedCode={state.scannedCode}
          isSubmitting={isSubmitting}
          onStartReading={(input, date) => performAction(startReading, input, date, "Lecture commencée !")}
          onPurchase={(input, date) =>
            performAction(recordPurchase, input, date, `Achat enregistré (−${PENALTY_POINTS}, effaçable).`)
          }
          onCancel={() => setState({ step: "scan" })}
        />
      </div>
    );
  }

  if (state.step === "pick-issue") {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">{state.seriesName}</h2>
        <p className="text-sm opacity-70">Quel numéro ?</p>
        <ul className="flex flex-col gap-2">
          {state.issues.map((issue) => (
            <li key={issue.gcdId}>
              <button
                type="button"
                onClick={() => resolvePickedIssue(issue.gcdId, state.scannedCode)}
                className="w-full rounded-lg border border-foreground/20 px-4 py-3 text-left"
              >
                <span className="font-semibold">#{issue.number}</span>
                {issue.title && <span className="ml-2 text-sm opacity-70">{issue.title}</span>}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setState({ step: "manual", scannedCode: state.scannedCode })} className="py-2 text-sm opacity-60">
          Aucun de ceux-là — saisie manuelle
        </button>
      </section>
    );
  }

  if (state.step === "pick-series") {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">Plusieurs séries partagent ce code</h2>
        <ul className="flex flex-col gap-4">
          {state.candidates.map((candidate) => (
            <li key={candidate.seriesId}>
              <p className="mb-1.5 font-semibold">
                {candidate.seriesName}
                {candidate.publisher && <span className="ml-2 text-sm font-normal opacity-70">{candidate.publisher}</span>}
              </p>
              <div className="flex flex-wrap gap-2">
                {candidate.issues.map((issue) => (
                  <button
                    key={issue.gcdId}
                    type="button"
                    onClick={() => resolvePickedIssue(issue.gcdId, state.scannedCode)}
                    className="rounded-full border border-foreground/20 px-3.5 py-1.5 text-sm"
                  >
                    #{issue.number}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setState({ step: "manual", scannedCode: state.scannedCode })} className="py-2 text-sm opacity-60">
          Aucun de ceux-là — saisie manuelle
        </button>
      </section>
    );
  }

  if (state.step === "manual") {
    return (
      <ManualEntryForm
        scannedCode={state.scannedCode}
        onSubmit={(input) => setState({ step: "sheet", book: manualInputToBook(input), scannedCode: input.barcodeRaw })}
        onCancel={() => setState({ step: "scan" })}
      />
    );
  }

  if (state.step === "done") {
    return (
      <section className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-4xl" aria-hidden>
          ✅
        </p>
        <h2 className="text-xl font-bold">{state.message}</h2>
        {state.detail && <p className="text-sm opacity-70">{state.detail}</p>}
        <button
          type="button"
          onClick={() => setState({ step: "scan" })}
          className="mt-4 rounded-full bg-amber-500 px-6 py-3 font-semibold text-black"
        >
          Scanner un autre bouquin
        </button>
      </section>
    );
  }

  // step === "scan"
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Scanner un bouquin</h1>
      {state.notice && (
        <p role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          {state.notice}
        </p>
      )}
      <BarcodeScanner onCode={lookup} />

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (manualCode.trim()) lookup(manualCode.trim());
        }}
      >
        <input
          value={manualCode}
          onChange={(event) => setManualCode(event.target.value)}
          inputMode="numeric"
          placeholder="…ou saisis le code-barres"
          aria-label="Code-barres"
          className="flex-1 rounded-md border border-foreground/20 bg-transparent px-3 py-2.5 text-sm"
        />
        <button type="submit" disabled={!manualCode.trim()} className="rounded-md border border-foreground/20 px-4 text-sm disabled:opacity-40">
          Chercher
        </button>
      </form>

      <button type="button" onClick={() => setState({ step: "manual", scannedCode: null })} className="py-1 text-sm underline opacity-60">
        Pas de code-barres ? Saisie manuelle
      </button>
    </section>
  );
}
