"use client";

import dynamic from "next/dynamic";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { CoverSheetBook } from "@/components/covers/cover-chooser-sheet";
import { ErrorAlert } from "@/components/error-alert";
import {
  startReading,
  recordPurchase,
  recordOwnership,
  recordOwnedPastReading,
  recordPastReading,
  type BookInput,
  type ScanActionResult,
} from "@/lib/books/actions";
import { adoptResolvedCover } from "@/lib/books/cover-adopt-actions";
import { Toast } from "@/components/ui/toast";
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
import { PendingInboxLink } from "./pending-inbox-link";
import { GradientWord, ScreenTitle } from "./screen-title";

/**
 * La feuille « Changer la couverture » en import DYNAMIQUE (fluidité #332,
 * item 11) : un geste rare de l'écran « done », dont tout le sous-arbre
 * (candidates, partage, mutations) pesait sur le premier chargement de `/` —
 * l'écran le plus pressé de l'app. Le chunk ne part qu'au premier rendu de la
 * feuille ; `ssr: false` — elle ne s'ouvre qu'après un geste.
 */
const CoverChooserSheet = dynamic(
  () => import("@/components/covers/cover-chooser-sheet").then((module) => module.CoverChooserSheet),
  { ssr: false },
);

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
  // coverPending (#332 item 3) : l'identité est là, l'image arrive — la feuille
  // s'affiche avec le placeholder, la vignette se pose quand la seconde phase répond.
  | { step: "sheet"; book: ResolvedBook; scannedCode: string | null; error?: string; isInLibrary?: boolean; wasFinished?: boolean; isOwned?: boolean; coverPending?: boolean }
  | { step: "pick-issue"; seriesName: string; issues: IssueCandidate[]; scannedCode: string }
  | { step: "pick-series"; candidates: SeriesCandidate[]; scannedCode: string }
  // suggestedCoverUrl : la chaîne couverture a abouti malgré l'identification
  // ratée (#55) — le formulaire l'affiche et explique le « image oui, infos non ».
  | { step: "manual"; scannedCode: string | null; suggestedCoverUrl?: string | null }
  // Plus d'étape « done » (fluidité #332, item 6) : un geste enregistré ramène
  // AU VISEUR tout de suite, le toast porte la confirmation et « Changer la
  // couverture » (#275) ; « Annuler » un achat vit à la Pile (« Je ne l'ai pas
  // acheté »), où il était déjà.
  // Le scan d'étagère (#101 lot C) : un mode plein écran, sa propre boucle.
  | { step: "burst" };

/** Le toast du scan : la confirmation d'un geste, avec son action (#332 item 6). */
type ScanToast = { message: string; action?: { label: string; onClick: () => void } };

/** Le malus affiché vient du barème — jamais recopié en dur (CLAUDE.md). */
const PENALTY_POINTS = Math.abs(SCORING_SCALE.unreadPurchasePenalty);

/** Le libellé d'un numéro dans les listes de choix — « [nn] » GCD = sans numéro (issue #58). */
const issueNumberLabel = (number: string) => (number === GCD_UNNUMBERED_ISSUE_NUMBER ? "Sans numéro" : `#${number}`);

/** Un BookInput saisi à la main, présenté comme un livre résolu pour réutiliser la feuille d'actions. */
const manualInputToBook = (input: BookInput): ResolvedBook => ({
  title: input.title,
  seriesName: input.seriesName,
  issueNumber: input.issueNumber,
  seriesRef: null, // une saisie manuelle ne connaît aucune notice de série
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

/**
 * `pendingInboxCount` : le compteur de la boîte de finition, en PROMESSE depuis
 * le serveur (#331 item 5) — l'écran monte sans l'attendre, la caméra part tout
 * de suite ; seule la pastille (`PendingInboxLink`, sous Suspense) le lit.
 */
export function ScanScreen({ pendingInboxCount = 0 }: { pendingInboxCount?: Promise<number> | number }) {
  const [state, setState] = useState<ScanState>({ step: "scan" });
  const [manualCode, setManualCode] = useState("");
  const [toast, setToast] = useState<ScanToast | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);
  /** La feuille « Changer la couverture », ouverte depuis le toast — le scanner est DÉMONTÉ tant qu'elle est là (photo). */
  const [coverSheetBook, setCoverSheetBook] = useState<CoverSheetBook | null>(null);
  /**
   * Le dernier livre enregistré depuis ce scan (item 6) : l'image de la
   * seconde phase (#345) peut arriver après le retour au viseur, voire après un
   * NOUVEAU scan — elle est adoptée par code, pas par requête.
   */
  const savedBooksRef = useRef(new Map<string, { bookId: string; coverUrl: string | null }>());

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
  /**
   * L'image arrivée en seconde phase pour le scan COURANT (review #345) : lue
   * par `performAction` au succès — si l'utilisateur a enregistré le livre
   * pendant que l'image voyageait, elle est posée après coup. Remise à zéro à
   * chaque nouveau lookup.
   */
  const deferredCoverRef = useRef<{ code: string; coverUrl: string } | null>(null);

  /**
   * La SECONDE phase du scan (#332, item 3) : l'identité est affichée, l'image
   * arrive ensuite. Elle se pose là où en est l'utilisateur — sur la feuille
   * (vignette), sur la saisie manuelle (image pré-remplie, #55), ou sur
   * l'écran « done » s'il a déjà enregistré le livre sans attendre : alors le
   * serveur l'adopte (`adoptResolvedCover`, jamais par-dessus une image ni un
   * choix). Une requête périmée (autre scan entre-temps) est ignorée.
   */
  const fetchDeferredCover = useCallback(async (code: string, requestId: number) => {
    let coverUrl: string | null = null;
    try {
      const response = await fetch(`/api/lookup/${encodeURIComponent(code)}/cover`);
      // Un 429 (le quota partagé avec le lookup) ou un 5xx : pas d'image — la
      // feuille garde son placeholder, la photo (#33) reste le filet.
      if (!response.ok) return;
      coverUrl = ((await response.json()) as { coverUrl: string | null }).coverUrl;
    } catch {
      return; // réseau coupé : même repli
    }
    if (coverUrl === null) return;
    const resolvedCoverUrl = coverUrl;
    // Le livre déjà enregistré depuis CE code (item 6 : l'utilisateur est
    // reparti au viseur, peut-être vers un autre livre) : adopté par code,
    // quelle que soit la requête courante.
    const saved = savedBooksRef.current.get(code);
    if (saved && saved.coverUrl === null) {
      saved.coverUrl = resolvedCoverUrl;
      void adoptResolvedCover(saved.bookId, resolvedCoverUrl);
    }
    if (requestId !== lookupIdRef.current) return; // un autre scan a pris la main : rien à afficher
    deferredCoverRef.current = { code, coverUrl: resolvedCoverUrl };
    setState((previous) => {
      if (previous.step === "sheet" && previous.coverPending) {
        return { ...previous, book: { ...previous.book, coverUrl: resolvedCoverUrl }, coverPending: false };
      }
      if (previous.step === "manual" && previous.scannedCode === code && !previous.suggestedCoverUrl) {
        return { ...previous, suggestedCoverUrl: resolvedCoverUrl };
      }
      return previous;
    });
  }, []);

  const lookup = useCallback(async (code: string) => {
    const requestId = ++lookupIdRef.current;
    deferredCoverRef.current = null;
    setState({ step: "loading", code });
    try {
      // `?defer=cover` (#332 item 3) : l'identité d'abord, l'image ensuite.
      const response = await fetch(`/api/lookup/${encodeURIComponent(code)}?defer=cover`);
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
        setState({ step: "sheet", book: result.book, scannedCode: code, coverPending: result.coverPending === true });
        if (result.coverPending) void fetchDeferredCover(code, requestId);
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
        // Le filet ultime — avec, parfois, la couverture quand même (#55),
        // qui arrive en seconde phase quand elle est différée.
        setState({ step: "manual", scannedCode: code, suggestedCoverUrl: result.coverUrl });
        if (result.coverPending) void fetchDeferredCover(code, requestId);
      } else {
        // invalid : un code inexploitable ne mérite pas d'être gardé.
        setState({ step: "manual", scannedCode: null });
      }
    } catch {
      if (requestId !== lookupIdRef.current) return;
      setState({ step: "scan", notice: "La recherche a échoué — réessaie ou saisis à la main." });
    }
  }, [fetchDeferredCover]);

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
    // OPTIMISTE (fluidité #332, item 6) : retour AU VISEUR au tap, le toast
    // confirme — le scanner, resté monté en veille (item 7), reprend sans
    // rejouer la caméra. La feuille est gardée sous la main pour se rouvrir
    // avec l'erreur si le serveur refuse.
    const sheetToReopen = state.step === "sheet" ? state : null;
    setState({ step: "scan" });
    setToast({ message: doneMessage });

    let result: ScanActionResult;
    try {
      result = await action(input, date);
    } catch {
      // La promesse d'une Server Action rejette quand le serveur est injoignable
      // (réseau coupé) : sans ce catch, le geste échouerait en silence.
      result = { ok: false, error: NETWORK_ERROR_MESSAGE };
    }

    if (!result.ok) {
      const failure = result.error;
      // Le serveur a dit non : la feuille se rouvre avec l'erreur si
      // l'utilisateur est encore au viseur — s'il a déjà relancé un scan, le
      // toast le dit, sans lui voler l'écran.
      let reopened = false;
      setState((previous) => {
        if (previous.step !== "scan" || sheetToReopen === null) return previous;
        reopened = true;
        return { ...sheetToReopen, error: failure };
      });
      setToast(reopened ? null : { message: `⚠️ ${failure}` });
      return;
    }
    // L'image arrivée PENDANT l'enregistrement (review #345) : l'input a été
    // construit au tap, sans elle — on l'adopte maintenant (le serveur ne pose
    // que sur `cover_url IS NULL`).
    const deferred = deferredCoverRef.current;
    const lateCoverUrl = input.coverUrl === null && deferred && deferred.code === input.barcodeRaw ? deferred.coverUrl : null;
    if (lateCoverUrl !== null) void adoptResolvedCover(result.bookId, lateCoverUrl);
    const coverUrl = input.coverUrl ?? lateCoverUrl;
    // Par CODE (review #346) : deux livres enregistrés vite l'un après l'autre
    // reçoivent chacun leur image, même arrivée après le scan suivant.
    if (input.barcodeRaw !== null) savedBooksRef.current.set(input.barcodeRaw, { bookId: result.bookId, coverUrl });

    const detail = result.isRereading
      ? "Tu l'avais déjà terminé — relecture !"
      : result.bookAlreadyExisted
        ? "Il était déjà dans ta bibliothèque."
        : null;
    // La couverture se change depuis le toast (#275) — le livre est dans la
    // main, c'est le moment de la photo. Un livre déjà connu a pu recevoir un
    // choix avant : la feuille le relira.
    const book: CoverSheetBook = { bookId: result.bookId, title: input.title, coverUrl, coverChosenAt: null };
    setToast({
      message: detail ? `${doneMessage} ${detail}` : doneMessage,
      action: { label: coverUrl === null ? "📷 Couverture" : "Changer la couverture", onClick: () => setCoverSheetBook(book) },
    });
  }

  if (state.step === "burst") {
    return <BurstMode pendingInboxCount={pendingInboxCount} onExit={() => setState({ step: "scan" })} />;
  }

  // Les étapes rendent SOUS la section du scanner, toujours montée (item 7) :
  // le flux caméra survit à la feuille d'actions, en veille, caché.
  const loadingContent = state.step === "loading" && (
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

  const sheetContent = state.step === "sheet" && (
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
          isSubmitting={false}
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

  const pickIssueContent = state.step === "pick-issue" && (
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

  const pickSeriesContent = state.step === "pick-series" && (
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

  const manualContent = state.step === "manual" && (
      <ManualEntryForm
        scannedCode={state.scannedCode}
        suggestedCoverUrl={state.suggestedCoverUrl}
        onSubmit={(input) => setState({ step: "sheet", book: manualInputToBook(input), scannedCode: input.barcodeRaw })}
        onCancel={() => setState({ step: "scan" })}
      />
  );

  // La section du scanner est TOUJOURS montée (item 7), cachée hors de l'étape
  // « scan » : le flux caméra reste ouvert en veille pendant la feuille, la
  // reprise ne rejoue ni getUserMedia ni l'autofocus. Elle est DÉMONTÉE quand
  // la feuille couverture est ouverte (photo : deux flux ne cohabitent pas) et
  // en rafale (son propre scanner).
  const isScanStep = state.step === "scan";
  return (
    <>
    <section className={`flex flex-col gap-4 ${isScanStep ? "" : "hidden"}`} aria-hidden={!isScanStep}>
      <ScreenTitle subtitle="Vise le code-barres, le reste suit.">
        Scanner <GradientWord>un bouquin</GradientWord>
      </ScreenTitle>
      {state.step === "scan" && state.notice && (
        <p role="alert" className="rounded-card border border-amber/40 bg-amber/10 p-3 text-sm text-ink">
          {state.notice}
        </p>
      )}
      {coverSheetBook === null && <BarcodeScanner onCode={lookup} paused={!isScanStep} />}

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

      {/* La pastille : impossible d'oublier ce qui attend, jamais intrusive.
          Sous Suspense : le compte arrive en streaming, rien ne l'attend. */}
      <Suspense fallback={null}>
        <PendingInboxLink count={pendingInboxCount} className="text-center" />
      </Suspense>
    </section>
    {loadingContent}
    {sheetContent}
    {pickIssueContent}
    {pickSeriesContent}
    {manualContent}
    {/* La feuille couverture, ouverte depuis le toast (item 6) ; la vignette
        changée reste dans la feuille elle-même (elle relit l'état réel). */}
    <CoverChooserSheet
      book={coverSheetBook}
      onClose={() => setCoverSheetBook(null)}
      onChanged={(_bookId, cover) => setCoverSheetBook((previous) => (previous ? { ...previous, ...cover } : previous))}
    />
    <Toast
      message={toast?.message ?? null}
      action={toast?.action}
      duration={toast?.action ? 5000 : 2600}
      onDismiss={dismissToast}
    />
    </>
  );
}
