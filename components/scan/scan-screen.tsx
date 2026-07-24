"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CoverPhotoButton } from "@/components/cover-photo-button";
import { ErrorAlert } from "@/components/error-alert";
import {
  startReading,
  recordPurchase,
  recordOwnership,
  recordOwnedPastReading,
  recordPastReading,
  softDeletePurchase,
  type BookInput,
  type ScanActionResult,
} from "@/lib/books/actions";
import type { JournalActionResult } from "@/lib/books/journal-actions";
import { FUTURE_DATE_MESSAGE, NETWORK_ERROR_MESSAGE } from "@/lib/books/errors";
import { localToday } from "@/lib/dates";
import { LOOKUP_RATE_LIMIT_MESSAGE } from "@/lib/resolution/lookup-rate-limit";
import { SCORING_SCALE } from "@/lib/scoring/scale";
import { GCD_UNNUMBERED_ISSUE_NUMBER, type IssueCandidate, type ResolvedBook, type ScanLookupResult, type SeriesCandidate } from "@/lib/resolution/types";
import { Button } from "@/components/ui/button";
import { BarcodeScanner } from "./barcode-scanner";
import { BookActionSheet } from "./book-action-sheet";
import { BurstMode } from "./burst-mode";
import { hasBurstSession } from "./burst-session";
import { ManualEntryForm } from "./manual-entry-form";
import { GradientWord, ScreenTitle } from "./screen-title";

/**
 * L'écran de scan — specs §5.3, dégradation douce : code complet = zéro
 * question, préfixe net = un tap (« quel numéro ? »), préfixe partagé = deux
 * taps, introuvable = saisie manuelle. Jamais d'échec sec.
 */

type ScanState =
  | { step: "scan"; notice?: string }
  | { step: "loading"; code: string }
  // isInLibrary : le livre vient de la bibliothèque de l'utilisateur (issue
  // #10) — la feuille l'annonce, « tu l'as déjà ». wasFinished : il a déjà été
  // TERMINÉ — la question « tu le relis ? » se pose AVANT de créer (§4.2, #35).
  | { step: "sheet"; book: ResolvedBook; scannedCode: string | null; error?: string; isInLibrary?: boolean; wasFinished?: boolean; isOwned?: boolean }
  | { step: "pick-issue"; seriesName: string; issues: IssueCandidate[]; scannedCode: string }
  | { step: "pick-series"; candidates: SeriesCandidate[]; scannedCode: string }
  // suggestedCoverUrl : la chaîne couverture a abouti malgré l'identification
  // ratée (#55) — le formulaire l'affiche et explique le « image oui, infos non ».
  | { step: "manual"; scannedCode: string | null; suggestedCoverUrl?: string | null }
  // purchaseId n'est porté que par un achat (pas une lecture) : c'est lui qui
  // arme le bouton « Annuler ». error : l'échec d'une annulation, affiché sur
  // place. photoBookId : le livre vient d'être enregistré SANS couverture —
  // on propose la photo, le filet ultime (specs §5.4, #33).
  | { step: "done"; message: string; detail: string | null; purchaseId?: string; error?: string; photoBookId?: string }
  // Le scan d'étagère (#101 lot C) : un mode plein écran, sa propre boucle.
  | { step: "burst" };

/** Le malus affiché vient du barème — jamais recopié en dur (CLAUDE.md). */
const PENALTY_POINTS = Math.abs(SCORING_SCALE.unreadPurchasePenalty);

/** Le libellé d'un numéro dans les listes de choix — « [nn] » GCD = sans numéro (issue #58). */
const issueNumberLabel = (number: string) => (number === GCD_UNNUMBERED_ISSUE_NUMBER ? "Sans numéro" : `#${number}`);

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

export function ScanScreen({ pendingInboxCount = 0 }: { pendingInboxCount?: number }) {
  const [state, setState] = useState<ScanState>({ step: "scan" });
  const [manualCode, setManualCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Une session de rafale interrompue par une navigation (aller compléter la
  // boîte de finition) REPREND toute seule (#131) — en effet, pas dans
  // l'initialisation : l'HTML serveur ne connaît pas sessionStorage, et un
  // état initial divergent casserait l'hydratation.
  useEffect(() => {
    // Un seul re-rendu, une seule fois au montage, sur condition rare : le
    // « cascading render » que la règle craint n'existe pas ici — et
    // l'alternative (initialiser l'état depuis sessionStorage) diverge du HTML
    // serveur et casse l'hydratation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hasBurstSession()) setState({ step: "burst" });
  }, []);

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
      if (response.status === 429) {
        setState({ step: "scan", notice: LOOKUP_RATE_LIMIT_MESSAGE });
        return;
      }
      const result = (await response.json()) as ScanLookupResult;
      if (requestId !== lookupIdRef.current) return;

      if (result.kind === "resolved") {
        setState({ step: "sheet", book: result.book, scannedCode: code });
      } else if (result.kind === "in-library") {
        // scannedCode: null — la feuille retombe sur book.barcode (le
        // barcode_raw STOCKÉ) : la dédup d'écriture matche à coup sûr. Passer
        // le code fraîchement scanné créerait un doublon quand le match vient
        // du repli ISBN (supplément prix scanné ou non — review #40).
        setState({
          step: "sheet",
          book: result.book,
          scannedCode: null,
          isInLibrary: true,
          wasFinished: result.hasFinishedReading,
          isOwned: result.isOwned,
        });
      } else if (result.kind === "pick-issue") {
        setState({ step: "pick-issue", seriesName: result.seriesName, issues: result.issues, scannedCode: code });
      } else if (result.kind === "pick-series") {
        setState({ step: "pick-series", candidates: result.candidates, scannedCode: code });
      } else if (result.kind === "not-found") {
        // Le filet ultime — avec, parfois, la couverture quand même (#55).
        setState({ step: "manual", scannedCode: code, suggestedCoverUrl: result.coverUrl });
      } else {
        // invalid : un code inexploitable ne mérite pas d'être gardé.
        setState({ step: "manual", scannedCode: null });
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
      if (requestId !== lookupIdRef.current) return; // requête périmée : la saisie manuelle a pris la main
      if (response.status === 401) {
        // Session expirée : on renvoie au scan avec le même message que `lookup`,
        // plutôt que de forcer une ressaisie à la main d'un livre que GCD connaît.
        setState({ step: "scan", notice: "Session expirée — reconnecte-toi." });
        return;
      }
      if (response.status === 429) {
        setState({ step: "scan", notice: LOOKUP_RATE_LIMIT_MESSAGE });
        return;
      }
      const result = (await response.json()) as ScanLookupResult;
      if (requestId !== lookupIdRef.current) return;
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

  // `D` couvre les deux familles de gestes : ceux qui EXIGENT une date (lecture,
  // achat) et ceux de #101 où elle est facultative (« je possède », « déjà lu »
  // — l'étagère d'avant n'a pas de date connue, et on ne l'invente pas).
  async function performAction<D extends string | null>(
    action: (input: BookInput, date: D) => Promise<ScanActionResult>,
    input: BookInput,
    date: D,
    doneMessage: string,
  ) {
    // Garde « pas de date future » : le max de l'input ne bloque pas une valeur
    // tapée à la main — on la refuse ici, contre le today LOCAL (pas d'UTC).
    if (date !== null && date > localToday()) {
      setState((previous) => (previous.step === "sheet" ? { ...previous, error: FUTURE_DATE_MESSAGE } : previous));
      return;
    }
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
      // Seul un achat remonte un purchaseId : lui seul peut s'annuler ici.
      purchaseId: result.purchaseId,
      // Toute la cascade n'a rien trouvé : la photo est le filet ultime (#33).
      photoBookId: input.coverUrl === null ? result.bookId : undefined,
    });
  }

  /** « Annuler » juste après un achat — la suppression douce, effet immédiat. */
  async function cancelPurchase(purchaseId: string) {
    setIsSubmitting(true);
    let result: JournalActionResult;
    try {
      result = await softDeletePurchase(purchaseId);
    } catch {
      // Serveur injoignable : la promesse rejette — sans ce catch, échec muet.
      result = { ok: false, error: NETWORK_ERROR_MESSAGE };
    } finally {
      setIsSubmitting(false);
    }

    if (!result.ok) {
      setState((previous) => (previous.step === "done" ? { ...previous, error: result.error } : previous));
      return;
    }
    // L'achat annulé : plus de purchaseId, le bouton « Annuler » disparaît.
    setState({ step: "done", message: "Achat annulé.", detail: null });
  }

  if (state.step === "burst") {
    return <BurstMode pendingInboxCount={pendingInboxCount} onExit={() => setState({ step: "scan" })} />;
  }

  if (state.step === "loading") {
    return (
      <div className="py-24 text-center">
        <p className="text-sm text-ink2">Résolution en cours…</p>
        <p className="mt-2 font-mono text-sm text-ink3">
          {state.code} · {state.code.length} chiffres
        </p>
        <div className="mt-6 flex justify-center">
          <Button type="button" variant="ghost" onClick={() => skipToManualEntry(state.code)}>
            Saisie manuelle
          </Button>
        </div>
      </div>
    );
  }

  if (state.step === "sheet") {
    return (
      <div className="flex flex-col gap-3">
        {state.error && <ErrorAlert message={state.error} />}
        {/* La bannière ne dit que du VRAI (#160) : « ta bibliothèque » =
            l'inventaire (règle partagée isInInventory), plus jamais la simple
            existence d'une fiche. Fiche connue hors inventaire et jamais lue
            (emprunt écarté, cédé sans lecture) → AUCUNE bannière : le
            pré-remplissage est un service silencieux, pas un statut. */}
        {state.isInLibrary && (state.isOwned || state.wasFinished) && (
          <p className="rounded-card border border-amber/40 bg-amber/10 p-3 text-sm text-ink">
            {state.wasFinished
              ? "Tu l'as déjà lu — tu le relis ?"
              : "Déjà dans ta bibliothèque — tes infos sont pré-remplies."}
          </p>
        )}
        <BookActionSheet
          book={state.book}
          scannedCode={state.scannedCode}
          isRereadingPrompt={state.wasFinished ?? false}
          isSubmitting={isSubmitting}
          onStartReading={(input, date) => performAction(startReading, input, date, "Lecture commencée !")}
          onPurchase={(input, date) =>
            performAction(recordPurchase, input, date, `Achat enregistré (−${PENALTY_POINTS}, effaçable).`)
          }
          onOwn={(input, ownedSince) =>
            performAction(recordOwnership, input, ownedSince, "Ajouté à ta bibliothèque.")
          }
          onPastReading={(input, finishedAt) =>
            // L'emprunt (#113) : lecture seule, aucune possession fabriquée.
            performAction(
              recordPastReading,
              input,
              finishedAt,
              finishedAt === null ? "Marqué comme lu (emprunt)." : "Lecture d'emprunt enregistrée.",
            )
          }
          onOwnedPastReading={(input, finishedAt) =>
            // Par défaut, « déjà lu » range AUSSI le livre dans l'étagère —
            // aligné sur la rafale et le titre de section (#113, §4.13).
            performAction(
              recordOwnedPastReading,
              input,
              finishedAt,
              finishedAt === null ? "Marqué comme lu." : "Lecture enregistrée.",
            )
          }
          onCancel={() => setState({ step: "scan" })}
        />
      </div>
    );
  }

  if (state.step === "pick-issue") {
    return (
      <section className="flex flex-col gap-3">
        <ScreenTitle subtitle="Quel numéro ?">{state.seriesName}</ScreenTitle>
        <ul className="flex flex-col gap-2">
          {state.issues.map((issue) => (
            <li key={issue.gcdId}>
              <button
                type="button"
                onClick={() => resolvePickedIssue(issue.gcdId, state.scannedCode)}
                className="w-full rounded-xl border border-line bg-card px-4 py-3 text-left transition active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
              >
                <span className="font-semibold text-ink">{issueNumberLabel(issue.number)}</span>
                {issue.title && <span className="ml-2 text-sm text-ink2">{issue.title}</span>}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setState({ step: "manual", scannedCode: state.scannedCode })} className="py-2 text-sm text-ink3">
          Aucun de ceux-là — saisie manuelle
        </button>
      </section>
    );
  }

  if (state.step === "pick-series") {
    return (
      <section className="flex flex-col gap-3">
        <ScreenTitle>Plusieurs séries partagent ce code</ScreenTitle>
        <ul className="flex flex-col gap-4">
          {state.candidates.map((candidate) => (
            <li key={candidate.seriesId}>
              <p className="mb-1.5 font-semibold text-ink">
                {candidate.seriesName}
                {candidate.publisher && <span className="ml-2 text-sm font-normal text-ink2">{candidate.publisher}</span>}
              </p>
              <div className="flex flex-wrap gap-2">
                {candidate.issues.map((issue) => (
                  <button
                    key={issue.gcdId}
                    type="button"
                    onClick={() => resolvePickedIssue(issue.gcdId, state.scannedCode)}
                    className="rounded-full border border-line bg-card px-3.5 py-1.5 text-sm text-ink transition active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
                  >
                    {issueNumberLabel(issue.number)}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setState({ step: "manual", scannedCode: state.scannedCode })} className="py-2 text-sm text-ink3">
          Aucun de ceux-là — saisie manuelle
        </button>
      </section>
    );
  }

  if (state.step === "manual") {
    return (
      <ManualEntryForm
        scannedCode={state.scannedCode}
        suggestedCoverUrl={state.suggestedCoverUrl}
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
        <h2 className="text-xl font-black uppercase italic tracking-tight text-ink">{state.message}</h2>
        {state.detail && <p className="text-sm text-ink2">{state.detail}</p>}
        {state.error && <ErrorAlert message={state.error} />}
        {state.photoBookId && <CoverPhotoButton bookId={state.photoBookId} />}
        {state.purchaseId && (
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => cancelPurchase(state.purchaseId!)}
            className="text-sm text-ink3 underline disabled:opacity-50"
          >
            Annuler
          </button>
        )}
        <Button type="button" variant="grad" onClick={() => setState({ step: "scan" })} className="mt-4">
          Scanner un autre bouquin
        </Button>
      </section>
    );
  }

  // step === "scan"
  return (
    <section className="flex flex-col gap-4">
      <ScreenTitle subtitle="Vise le code-barres, le reste suit.">
        Scanner <GradientWord>un bouquin</GradientWord>
      </ScreenTitle>
      {state.notice && (
        <p role="alert" className="rounded-card border border-amber/40 bg-amber/10 p-3 text-sm text-ink">
          {state.notice}
        </p>
      )}
      <BarcodeScanner onCode={lookup} />

      {/* Le champ « search » du proto (§5) : surface --card, une pill. */}
      <form
        className="flex items-center gap-2 rounded-2xl border border-line bg-card px-4 py-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (manualCode.trim()) lookup(manualCode.trim());
        }}
      >
        <input
          value={manualCode}
          onChange={(event) => setManualCode(event.target.value)}
          inputMode="numeric"
          placeholder="Ou tape le code-barres…"
          aria-label="Code-barres"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink3 focus-visible:outline-none"
        />
        <button
          type="submit"
          disabled={!manualCode.trim()}
          className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold text-ink2 transition active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan disabled:opacity-40"
        >
          Chercher
        </button>
      </form>

      <Button type="button" variant="ghost" block onClick={() => setState({ step: "manual", scannedCode: null })}>
        Pas de code-barres ? Saisie manuelle
      </Button>

      {/* L'entrée du scan d'étagère (#101 lot C) — un mode à part, pas un
          réglage du scan normal : l'intention y vaut pour toute la session. */}
      <Button type="button" variant="ghost" block onClick={() => setState({ step: "burst" })}>
        Scanner une étagère (rafale)
      </Button>

      {/* La pastille : impossible d'oublier ce qui attend, jamais intrusive. */}
      {pendingInboxCount > 0 && (
        <a
          href="/finition"
          className="rounded-card border border-amber/40 bg-amber/10 p-3 text-center text-sm text-ink underline underline-offset-2"
        >
          {pendingInboxCount} livre{pendingInboxCount > 1 ? "s" : ""} à compléter
        </a>
      )}
    </section>
  );
}
