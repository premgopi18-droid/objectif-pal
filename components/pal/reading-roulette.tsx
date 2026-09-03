"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BookCover } from "@/components/book-cover";
import { ErrorAlert } from "@/components/error-alert";
import { StartReadingButton, useBookGestures } from "@/components/library/book-gestures";
import { Button } from "@/components/ui/button";
import { burstConfetti, prefersReducedMotion } from "@/components/ui/confetti";
import { Toast } from "@/components/ui/toast";
import { ALL_CATEGORIES, CATEGORY_LABELS } from "@/lib/books/categories";
import { formatBookSubtitle } from "@/lib/books/format";
import type { PalEntry } from "@/lib/pal/derive-pal";
import {
  buildReelSequence,
  categoryCounts,
  drawEntry,
  eligibleEntries,
  REEL_WINNER_INDEX,
} from "@/lib/pal/roulette";
import type { BookCategory } from "@/lib/scoring/types";

/**
 * La roulette de la PAL (#262, maquette validée — variante « la bande ») :
 * depuis la Pile, un tirage au sort de la prochaine lecture. Les couvertures
 * défilent sous un curseur dégradé, décélèrent, s'arrêtent sur l'élue — puis
 * « Je commence » (le geste RÉEL, partagé) ou « Relancer », à volonté.
 *
 * Le tirage n'écrit RIEN : tout est local tant que « Je commence » n'est pas
 * tapé. Le hasard et le filtrage vivent dans lib/pal/roulette (module pur,
 * testé) ; ici, seulement la mise en scène et les gestes.
 */

/* La géométrie de la bande — accordée à BookCover `large` (w-24 = 96px) et au gap-3 (12px). */
const REEL_COVER_WIDTH_PX = 96;
const REEL_GAP_PX = 12;
const REEL_STEP_PX = REEL_COVER_WIDTH_PX + REEL_GAP_PX;
/** Départ rapide, longue décélération — le suspense de la maquette. */
const SPIN_DURATION_MS = 3800;
const SPIN_EASING = "cubic-bezier(0.15, 0.65, 0.05, 1)";
/** Filet si `transitionend` se perd (onglet passé en arrière-plan…) : on révèle quand même. */
const SPIN_FAILSAFE_MS = SPIN_DURATION_MS + 600;
/** Au repos, la bande n'est qu'un décor : quelques couvertures suffisent. */
const IDLE_STRIP_LENGTH = 8;

const NO_FILTER: ReadonlySet<BookCategory> = new Set();

type RoulettePhase =
  | { kind: "idle" }
  | { kind: "spinning"; sequence: PalEntry[]; winner: PalEntry }
  | { kind: "revealed"; sequence: PalEntry[]; winner: PalEntry };

/**
 * Le chip multi-sélection du tirage — même vêtement que FilterChips (§4 design),
 * mais FilterChips est mono-valeur par contrat : la variante à bascule vit ici.
 */
function chipClassName(active: boolean): string {
  return (
    "flex-none rounded-full border px-3 py-1.5 text-[13px] font-semibold transition " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan disabled:opacity-40 " +
    (active ? "bg-grad border-transparent text-bg0" : "border-line bg-card text-ink2")
  );
}

export function ReadingRoulette({ entries, disabled = false }: { entries: PalEntry[]; disabled?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<ReadonlySet<BookCategory>>(NO_FILTER);
  const [phase, setPhase] = useState<RoulettePhase>({ kind: "idle" });
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  // La roulette a SA plomberie de geste : son erreur s'affiche dans l'overlay,
  // pas derrière lui dans l'ErrorAlert de la vue.
  const { run, isPending, error, setError } = useBookGestures();

  const overlayRef = useRef<HTMLDivElement>(null);
  const reelWrapRef = useRef<HTMLDivElement>(null);
  const reelRef = useRef<HTMLDivElement>(null);
  const launchRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const startCtaRef = useRef<HTMLButtonElement>(null);

  const counts = useMemo(() => categoryCounts(entries), [entries]);
  // Les chips dans l'ordre du barème, effectifs non nuls seulement.
  const presentCategories = useMemo(
    () => ALL_CATEGORIES.filter((category) => (counts.get(category) ?? 0) > 0),
    [counts],
  );
  const pool = useMemo(() => eligibleEntries(entries, selectedCategories), [entries, selectedCategories]);
  const totalEligible = useMemo(() => eligibleEntries(entries, NO_FILTER).length, [entries]);

  function open() {
    // Une catégorie sélectionnée peut avoir disparu depuis (livre commencé
    // ailleurs) : on purge pour ne jamais rouvrir sur un filtre fantôme.
    setSelectedCategories((previous) => new Set([...previous].filter((category) => (counts.get(category) ?? 0) > 0)));
    setPhase({ kind: "idle" });
    setError(null);
    setIsOpen(true);
  }

  const close = useCallback(() => {
    if (isPending) return; // le geste en vol garde son écran
    setIsOpen(false);
    setPhase({ kind: "idle" });
    setError(null);
  }, [isPending, setError]);

  function toggleCategory(category: BookCategory | null) {
    setPhase({ kind: "idle" }); // l'élue d'un autre filtre ne vaut plus
    setError(null);
    setSelectedCategories((previous) => {
      if (category === null) return NO_FILTER;
      const next = new Set(previous);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  function launch() {
    const winner = drawEntry(pool);
    if (winner === null) return;
    setError(null);
    setPhase({ kind: "spinning", sequence: buildReelSequence(pool, winner), winner });
  }

  function handleStarted() {
    setIsOpen(false);
    setPhase({ kind: "idle" });
    setToastMessage("C'est parti — bonne lecture 📖");
  }

  // La bande défile : translateX vers l'élue, décélération CSS, puis révélation.
  useLayoutEffect(() => {
    if (phase.kind !== "spinning") return;
    const reel = reelRef.current;
    const wrap = reelWrapRef.current;
    const finish = () => setPhase({ kind: "revealed", sequence: phase.sequence, winner: phase.winner });
    if (!reel || !wrap) {
      finish();
      return;
    }
    // Amener le CENTRE de l'élue sous le curseur (le centre du cadre).
    const target = REEL_WINNER_INDEX * REEL_STEP_PX + REEL_COVER_WIDTH_PX / 2 - wrap.clientWidth / 2;
    if (prefersReducedMotion()) {
      // Même garde JS que les confettis : résultat immédiat, zéro défilement.
      reel.style.transition = "none";
      reel.style.transform = `translateX(${-target}px)`;
      finish();
      return;
    }
    reel.style.transition = "none";
    reel.style.transform = "translateX(0px)";
    void reel.offsetWidth; // le reflow arme la transition depuis le départ, pas depuis l'état d'avant
    reel.style.transition = `transform ${SPIN_DURATION_MS}ms ${SPIN_EASING}`;
    reel.style.transform = `translateX(${-target}px)`;
    // Garde sur la CIBLE : les vignettes ont leurs propres transitions, leurs
    // transitionend remontent jusqu'ici et révéleraient trop tôt.
    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target === reel) finish();
    };
    reel.addEventListener("transitionend", onTransitionEnd);
    const failsafe = setTimeout(finish, SPIN_FAILSAFE_MS);
    return () => {
      reel.removeEventListener("transitionend", onTransitionEnd);
      clearTimeout(failsafe);
    };
  }, [phase]);

  // Retour au repos (changement de filtre, réouverture) : la bande revient au départ.
  useLayoutEffect(() => {
    if (phase.kind !== "idle") return;
    const reel = reelRef.current;
    if (!reel) return;
    reel.style.transition = "none";
    reel.style.transform = "translateX(0px)";
  }, [phase]);

  // Le moment de gloire : les confettis jaillissent de l'élue (no-op sous reduced-motion).
  useEffect(() => {
    if (phase.kind !== "revealed") return;
    const winnerCover = reelRef.current?.children.item(REEL_WINNER_INDEX);
    if (!(winnerCover instanceof HTMLElement)) return;
    const rect = winnerCover.getBoundingClientRect();
    burstConfetti({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }, [phase]);

  // Dialog : focus à l'ouverture, Échap ferme, Tab reste dans l'overlay.
  useEffect(() => {
    if (!isOpen) return;
    (launchRef.current ?? closeRef.current)?.focus();
  }, [isOpen]);
  // Le fond ne défile pas sous l'overlay (review #268) : sans verrou, un drag
  // vertical faisait défiler la Pile derrière — invisible, découvert à la
  // fermeture. Restauré tel quel au démontage.
  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);
  // À la révélation, le focus a été perdu (« Lancer » s'est désactivé pendant
  // le défilement) : on le pose sur « Je commence » (review #268) — le même
  // geste que BulkReadSheet à l'ouverture.
  useEffect(() => {
    if (phase.kind !== "revealed") return;
    startCtaRef.current?.focus();
  }, [phase]);
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const container = overlayRef.current;
      if (!container) return;
      const focusables = [...container.querySelectorAll<HTMLElement>("button:not([disabled])")];
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, close]);

  const reelItems = phase.kind === "idle" ? pool.slice(0, IDLE_STRIP_LENGTH) : phase.sequence;
  const isSpinning = phase.kind === "spinning";

  return (
    <>
      {/* Le liseré magenta signale le jeu SANS le dégradé plein (réservé aux CTA,
          §2) — en ring, jamais en border-color : l'ordre du CSS compilé ne
          garantit pas l'emport sur border-line (leçon #242). */}
      <Button
        type="button"
        variant="ghost"
        disabled={disabled}
        onClick={open}
        aria-haspopup="dialog"
        className="ring-1 ring-magenta/45"
      >
        🎲 Tirage
      </Button>

      {isOpen && (
        <div
          ref={overlayRef}
          role="dialog"
          aria-modal="true"
          aria-label="Tirer ma prochaine lecture au sort"
          className="animate-[fade-in_240ms_ease] fixed inset-0 z-50 bg-bg0"
        >
          <div className="mx-auto flex h-full w-full max-w-md flex-col px-4 pb-8 pt-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-xl font-black uppercase italic tracking-tight text-ink">
                Prochaine <span className="bg-grad bg-clip-text text-transparent">lecture</span>
              </h2>
              <button
                ref={closeRef}
                type="button"
                onClick={close}
                disabled={isPending}
                aria-label="Fermer le tirage"
                className="-mr-1 rounded-full px-2.5 py-1 text-lg text-ink3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan disabled:opacity-40"
              >
                ✕
              </button>
            </div>
            <p className="mt-0.5 text-sm text-ink3">
              {pool.length === 0
                ? "Aucun livre dans le tirage"
                : `${pool.length} livre${pool.length > 1 ? "s" : ""} dans le tirage`}
            </p>

            {presentCategories.length > 1 && (
              <div role="group" aria-label="Catégories du tirage" className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-pressed={selectedCategories.size === 0}
                  disabled={isSpinning}
                  onClick={() => toggleCategory(null)}
                  className={chipClassName(selectedCategories.size === 0)}
                >
                  Toutes · {totalEligible}
                </button>
                {presentCategories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    aria-pressed={selectedCategories.has(category)}
                    disabled={isSpinning}
                    onClick={() => toggleCategory(category)}
                    className={chipClassName(selectedCategories.has(category))}
                  >
                    {CATEGORY_LABELS[category]} · {counts.get(category)}
                  </button>
                ))}
              </div>
            )}

            <div className="flex min-h-0 flex-1 flex-col justify-center">
              {pool.length === 0 ? (
                <p className="px-4 text-center text-sm leading-relaxed text-ink2">
                  {selectedCategories.size > 0
                    ? "Aucun livre tirable dans ces catégories — élargis le filtre."
                    : "Toute la pile est déjà en cours de lecture — termine un livre avant d'en tirer un nouveau 🙂"}
                </p>
              ) : (
                <div ref={reelWrapRef} className="relative -mx-4 overflow-hidden py-3">
                  {/* Le curseur : trait dégradé, pointe magenta — c'est LUI qui désigne. */}
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-y-1 left-1/2 z-10 w-[3px] -translate-x-1/2 rounded-full bg-grad shadow-grad"
                  >
                    <span className="absolute -top-1 left-1/2 size-2.5 -translate-x-1/2 rotate-45 rounded-[2px] bg-magenta" />
                  </div>
                  {/* Fondus latéraux : la bande naît et meurt dans la nuit du fond. */}
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 left-0 z-10 w-14 bg-[linear-gradient(90deg,var(--bg0),transparent)]"
                  />
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 right-0 z-10 w-14 bg-[linear-gradient(-90deg,var(--bg0),transparent)]"
                  />
                  {/* La bande est un décor (le résultat est annoncé en clair dessous). */}
                  <div ref={reelRef} aria-hidden className="flex w-max gap-3">
                    {reelItems.map((item, index) => (
                      <div
                        key={index}
                        className={`w-24 flex-none rounded-md transition ${
                          phase.kind === "revealed" && index === REEL_WINNER_INDEX
                            ? "scale-105 ring-2 ring-cyan shadow-float"
                            : ""
                        }`}
                      >
                        <BookCover coverUrl={item.coverUrl} size="large" title={item.title} bookId={item.bookId} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* La révélation, annoncée aux lecteurs d'écran (la bande est décorative). */}
              <div aria-live="polite" className="min-h-16 text-center">
                {phase.kind === "revealed" && (
                  <>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-ink3">Le sort a parlé</p>
                    <p className="mt-1 text-balance text-lg font-black text-ink">{phase.winner.title}</p>
                    <p className="mt-0.5 text-sm text-ink2">
                      {formatBookSubtitle(
                        phase.winner.seriesName,
                        phase.winner.issueNumber,
                        CATEGORY_LABELS[phase.winner.category],
                      )}
                    </p>
                  </>
                )}
              </div>
            </div>

            {error && <ErrorAlert message={error} />}

            <div className="mt-3">
              {phase.kind === "revealed" ? (
                <div className="flex flex-col gap-2.5">
                  {/* Le geste RÉEL, partagé (§4.6) — au succès l'overlay se ferme,
                      la lecture est visible dans la pile derrière. */}
                  <StartReadingButton
                    ref={startCtaRef}
                    bookId={phase.winner.bookId}
                    block
                    isPending={isPending}
                    run={(action, onSuccess) =>
                      run(action, () => {
                        onSuccess?.();
                        handleStarted();
                      })
                    }
                  />
                  <Button type="button" variant="ghost" block disabled={isPending} onClick={launch}>
                    Relancer 🎲
                  </Button>
                </div>
              ) : (
                <Button
                  ref={launchRef}
                  type="button"
                  variant="grad"
                  block
                  disabled={isSpinning || pool.length === 0}
                  onClick={launch}
                >
                  {isSpinning ? "Tirage en cours…" : "Lancer le tirage 🎲"}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </>
  );
}
