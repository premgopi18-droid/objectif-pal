"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BookCover } from "@/components/book-cover";
import { ErrorAlert } from "@/components/error-alert";
import { Button } from "@/components/ui/button";
import { getCoverState, recordCoverPhoto, resetCoverToAutomatic, type CoverActionResult } from "@/lib/books/cover-actions";
import { chooseCover, getCoverCandidates, searchEditionCovers, type CoverCandidatesActionResult } from "@/lib/books/cover-choice-actions";
import type { CoverCandidate } from "@/lib/covers/candidates";
import { authorForSearch, EDITION_QUERY_MAX_LENGTH } from "@/lib/covers/edition-query";
import { shareCover, unshareCover } from "@/lib/books/cover-share-actions";
import { deriveShareState } from "@/lib/covers/share-state";
import { coverPhotoPath, COVERS_BUCKET, fileToWebpBlob } from "@/lib/books/cover-photo";
import { NETWORK_ERROR_MESSAGE } from "@/lib/books/errors";
import { deriveCoverSheetState } from "@/lib/covers/sheet-state";

/**
 * La feuille « Changer la couverture » (#275, epic #274) — LE lieu unique du
 * choix : couverture actuelle et son origine, les **candidates** de toutes les
 * sources (#276 — chargées à l'ouverture, en parallèle, sous quota ; variante
 * scannée entourée pour la VO), les **autres éditions** (#277 — au tap
 * seulement, requête modifiable, jamais posées toutes seules), photo ou
 * import galerie, et « Revenir à l'automatique » quand un choix existe.
 *
 * Les candidates sont des `<img>` bruts, hors `next/image` : une dizaine
 * d'images jetables par ouverture brûleraient les transformations Vercel pour
 * rien — seule la couverture choisie, rapatriée la nuit suivante, repasse par
 * l'optimiseur. Une candidate qui ne charge pas disparaît de la grille.
 *
 * **Autonome** (review #280) : l'écran qui l'ouvre ne connaît pas toujours
 * l'état réel du livre — le Journal n'a pas `cover_chosen_at`, l'écran de fin
 * de scan ne sait pas ce qu'un livre déjà connu avait. La feuille part de ce
 * qu'on lui passe (affichage immédiat) et **relit l'état en base** à
 * l'ouverture. C'est aussi ce qui la rend montable au Journal, où vivent les
 * emprunts lus — qui n'ont pas de fiche en Biblio (l'inventaire, #152).
 *
 * Un seul exemplaire monté par écran, recyclé pour tous les livres (motif
 * `category-drawer`) ; patron de dialogue maison (fond cliquable, Échap,
 * focus à l'ouverture, animations sous `prefers-reduced-motion`, cf.
 * `SeriesAlignSheet`).
 *
 * Deux inputs, deux gestes DÉTERMINISTES sur tous les OS (#50) : un input
 * `capture` pour la caméra, un input nu pour la galerie — les navigateurs
 * sont incohérents sans `capture` (Chrome Android ouvre les fichiers SANS
 * option caméra, vécu).
 */

export type CoverSheetBook = {
  bookId: string;
  title: string;
  coverUrl: string | null;
  /** Inconnu de l'écran appelant ? Passer `null` : la feuille relit la vérité en base. */
  coverChosenAt: string | null;
  /** Les auteurs, s'ils sont connus — pré-remplissent la recherche d'éditions (#277). */
  authors?: string | null;
  /** Un code exploitable par les sources ? Inconnu (`undefined`) tant que la base n'a pas répondu. */
  hasCode?: boolean;
  /** Le code exact — la clé du pool partagé (#278) ; inconnu tant que la base n'a pas répondu. */
  barcodeRaw?: string | null;
  /** La couverture-source de ma contribution vivante pour ce code (#278). */
  sharedSourceCoverUrl?: string | null;
};

type CandidatesState =
  | { status: "loading" }
  | { status: "offline" }
  | { status: "error"; message: string }
  | { status: "ready"; candidates: CoverCandidate[]; degraded: boolean };

/** Les autres éditions : rien tant qu'on n'a pas tapé « Chercher ». */
type EditionsState = { status: "idle" } | CandidatesState;

type CoverChooserSheetProps = {
  book: CoverSheetBook | null;
  onClose: () => void;
  /** La couverture a changé : le parent met sa liste à jour (la vignette suit tout de suite). */
  onChanged: (bookId: string, cover: { coverUrl: string | null; coverChosenAt: string | null }) => void;
};

const INPUT_CLASS =
  "min-w-0 flex-1 rounded-xl border border-line bg-card2 px-3 py-2 text-sm text-ink placeholder:text-ink3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan";

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

const toCandidatesState = (result: CoverCandidatesActionResult): CandidatesState =>
  result.ok ? { status: "ready", candidates: result.candidates, degraded: result.degraded } : { status: "error", message: result.error };

export function CoverChooserSheet({ book, onClose, onChanged }: CoverChooserSheetProps) {
  if (!book) return null;
  // `key` sur le livre : ré-ouvrir sur un autre livre remonte un corps neuf
  // (erreur, confirmation, envoi repartent propres) — sans effet ni setState.
  return <SheetBody key={book.bookId} book={book} onClose={onClose} onChanged={onChanged} />;
}

function SheetBody({ book: initial, onClose, onChanged }: CoverChooserSheetProps & { book: CoverSheetBook }) {
  const router = useRouter();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);
  /** L'état affiché : ce que l'appelant savait, puis la vérité relue en base. */
  const [book, setBook] = useState<CoverSheetBook>(initial);
  const [busy, setBusy] = useState<"upload" | "reset" | "choose" | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Hors ligne, on le dit tout de suite au lieu de charger dans le vide — décidé
  // à l'ouverture (la feuille n'est jamais rendue côté serveur : `book` y est nul).
  const [candidates, setCandidates] = useState<CandidatesState>(() => (isOffline() ? { status: "offline" } : { status: "loading" }));
  const [editions, setEditions] = useState<EditionsState>({ status: "idle" });
  /** La requête d'éditions (#277) : pré-remplie depuis le livre, MODIFIABLE. */
  const [editionTitle, setEditionTitle] = useState(initial.title);
  const [editionAuthor, setEditionAuthor] = useState(authorForSearch(initial.authors ?? null) ?? "");
  /** Vrai dès que l'utilisateur a touché la requête : la relecture en base ne l'écrase plus. */
  const queryTouched = useRef(false);

  // Les candidates (#276) : à la demande, à l'ouverture — jamais au scan. Le
  // résultat arrive en `.then` (asynchrone) : rien n'est posé pendant l'effet.
  const fetchCandidates = useCallback(
    (bookId: string) =>
      getCoverCandidates(bookId)
        .then((result) => setCandidates(toCandidatesState(result)))
        .catch(() => setCandidates({ status: "error", message: NETWORK_ERROR_MESSAGE })),
    [],
  );

  useEffect(() => {
    if (isOffline()) return;
    fetchCandidates(initial.bookId);
  }, [initial.bookId, fetchCandidates]);

  /** « Réessayer » : repasse en chargement puis relance — un tap, pas un effet. */
  const retryCandidates = () => {
    setCandidates({ status: "loading" });
    fetchCandidates(book.bookId);
  };

  /** « Chercher d'autres éditions » (#277) : au tap seulement, jamais à l'ouverture. */
  const searchEditions = () => {
    if (isOffline()) {
      setEditions({ status: "offline" });
      return;
    }
    setEditions({ status: "loading" });
    searchEditionCovers(book.bookId, { title: editionTitle, author: editionAuthor.trim() === "" ? null : editionAuthor })
      .then((result) => setEditions(toCandidatesState(result)))
      .catch(() => setEditions({ status: "error", message: NETWORK_ERROR_MESSAGE }));
  };

  /** Une candidate dont l'image ne charge pas (cadavre epagine/Inventaire), ou qui vient d'être choisie, sort des grilles. */
  const hideCandidate = (url: string) => {
    const without = <T extends EditionsState>(previous: T): T =>
      previous.status === "ready" ? { ...previous, candidates: previous.candidates.filter((candidate) => candidate.url !== url) } : previous;
    setCandidates(without);
    setEditions(without);
  };

  async function handleChoose(candidate: CoverCandidate) {
    setBusy("choose");
    setError(null);
    setSuccess(null);
    try {
      applied(await chooseCover(book.bookId, candidate.url), new Date().toISOString(), "Couverture choisie ✓");
      hideCandidate(candidate.url);
    } catch {
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setBusy(null);
    }
  }

  // À l'ouverture : le focus entre dans le dialogue (a11y, review #280), et
  // l'état réel est relu — une réponse en échec laisse l'état initial, le
  // geste reste possible (le serveur re-vérifie de toute façon).
  useEffect(() => {
    firstActionRef.current?.focus();
    let cancelled = false;
    getCoverState(initial.bookId)
      .then((state) => {
        if (cancelled || !state.ok) return;
        setBook({
          bookId: initial.bookId,
          title: state.title,
          coverUrl: state.coverUrl,
          coverChosenAt: state.coverChosenAt,
          authors: state.authors,
          hasCode: state.hasCode,
          barcodeRaw: state.barcodeRaw,
          sharedSourceCoverUrl: state.sharedSourceCoverUrl,
        });
        // La requête d'éditions suit la fiche tant que l'utilisateur n'y a pas touché.
        if (!queryTouched.current) {
          setEditionTitle(state.title);
          setEditionAuthor(authorForSearch(state.authors) ?? "");
        }
        // Une couverture RAPATRIÉE d'une source se partage par défaut (#278,
        // décision du 12/09) : rien de personnel dessus. La case apparaît
        // cochée, et décocher retire. Une photo, elle, attend le geste.
        const shareState = deriveShareState({ coverUrl: state.coverUrl, barcodeRaw: state.barcodeRaw, sharedSourceCoverUrl: state.sharedSourceCoverUrl });
        if (shareState.shareable && shareState.defaultChecked && !shareState.shared && !shareState.stale) {
          shareCover(initial.bookId)
            .then((result) => {
              if (!cancelled && result.ok && result.shared) setBook((previous) => ({ ...previous, sharedSourceCoverUrl: previous.coverUrl }));
            })
            .catch(() => {
              // Pas grave : la case restera décochée, le geste manuel reste possible.
            });
        }
      })
      .catch(() => {
        // Serveur injoignable : on reste sur ce que l'appelant savait.
      });
    return () => {
      cancelled = true;
    };
  }, [initial.bookId]);

  // Échap ferme (sauf pendant un envoi : on ne laisse pas un upload orphelin).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && busy === null) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const state = deriveCoverSheetState({ coverUrl: book.coverUrl, coverChosenAt: book.coverChosenAt });
  // Le partage (#278) — dérivé pur, inconnu tant que la base n'a pas répondu (`barcodeRaw` undefined).
  const share =
    book.barcodeRaw === undefined
      ? null
      : deriveShareState({ coverUrl: book.coverUrl, barcodeRaw: book.barcodeRaw, sharedSourceCoverUrl: book.sharedSourceCoverUrl ?? null });
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  async function toggleShare(next: boolean) {
    setShareBusy(true);
    setShareError(null);
    try {
      const result = next ? await shareCover(book.bookId) : await unshareCover(book.bookId);
      if (!result.ok) {
        setShareError(result.error);
        return;
      }
      // La contribution reflète désormais (ou plus) la couverture actuelle.
      setBook((previous) => ({ ...previous, sharedSourceCoverUrl: result.shared ? previous.coverUrl : null }));
    } catch {
      setShareError(NETWORK_ERROR_MESSAGE);
    } finally {
      setShareBusy(false);
    }
  }

  const applied = (result: CoverActionResult, chosenAt: string | null, message: string) => {
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const cover = { coverUrl: result.coverUrl, coverChosenAt: chosenAt };
    setBook((previous) => ({ ...previous, ...cover }));
    setSuccess(message);
    onChanged(book.bookId, cover);
    // Les Server Components (Journal, Bilan) se resynchronisent ; la liste du
    // parent, elle, a déjà bougé via onChanged.
    router.refresh();
  };

  async function handleFile(file: File) {
    setBusy("upload");
    setError(null);
    setSuccess(null);
    try {
      const blob = await fileToWebpBlob(file);
      // Import DYNAMIQUE (#123) : le client Supabase (63 KB gz) ne sert qu'à
      // l'upload — il ne se charge qu'au geste.
      const { createBrowserSupabaseClient } = await import("@/lib/supabase/browser");
      const supabase = createBrowserSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Session expirée — reconnecte-toi.");
        return;
      }
      const { error: uploadError } = await supabase.storage
        .from(COVERS_BUCKET)
        .upload(coverPhotoPath(user.id, book.bookId), blob, { upsert: true, contentType: "image/webp" });
      if (uploadError) {
        console.error("[covers] upload:", uploadError.message);
        setError("L'envoi de la photo a échoué — réessaie.");
        return;
      }
      applied(
        await recordCoverPhoto(book.bookId),
        new Date().toISOString(),
        book.coverUrl === null ? "Couverture ajoutée ✓" : "Couverture remplacée ✓",
      );
    } catch {
      // Conversion impossible ou serveur injoignable : jamais d'échec muet.
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setBusy(null);
    }
  }

  async function handleReset() {
    setBusy("reset");
    setError(null);
    setSuccess(null);
    try {
      applied(await resetCoverToAutomatic(book.bookId), null, "L'app a repris la main ✓");
      setConfirmReset(false);
    } catch {
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setBusy(null);
    }
  }

  const onFileChosen = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // La même photo doit pouvoir être re-choisie après une erreur.
    event.target.value = "";
    if (file) handleFile(file);
  };

  // Un livre sans code (saisie manuelle) n'a rien à demander aux sources : la
  // section « Proposées » se tait, les autres éditions viennent en premier.
  const showSources = book.hasCode !== false;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Changer la couverture de ${book.title}`}
      className="animate-[fade-in_240ms_ease] fixed inset-0 z-50 flex items-end bg-black/60"
      onClick={() => busy === null && onClose()}
    >
      <div
        className="animate-[sheet-in_280ms_cubic-bezier(0.32,0.72,0.24,1)] max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border-t border-line bg-card p-4 pb-8"
        onClick={(event) => event.stopPropagation()}
      >
        <div aria-hidden className="mx-auto h-1 w-10 rounded-full bg-line" />
        <h2 className="mt-3 text-base font-black text-ink">Changer la couverture</h2>
        <p className="mt-0.5 truncate text-sm text-ink2">{book.title}</p>

        <div className="mt-4 flex items-center gap-4">
          <BookCover coverUrl={book.coverUrl} size="large" title={book.title} bookId={book.bookId} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">{state.label}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink3">
              {state.origin === "none"
                ? "Aucune source n'a d'image pour ce livre : prends-le en photo, il est peut-être sous ta main."
                : state.origin === "automatic"
                  ? "Posée par l'app. Remplace-la par ta photo : elle ne sera plus touchée."
                  : "Elle est à toi : l'app ne la remplacera plus jamais toute seule."}
            </p>
            {success !== null && (
              <p role="status" className="mt-2 text-sm font-medium text-green">
                {success}
              </p>
            )}
          </div>
        </div>

        {/* Le pool partagé (#278) : proposer SA couverture aux autres pour le
            même code. Opt-in pour une photo (une main, un salon…), la case
            reflète l'état réel ; une rapatriée d'une source se partage sans
            arrière-pensée. Jamais un remplacement chez les autres. */}
        {share?.shareable && (
          <div className="mt-3 flex flex-col gap-1">
            <label className="flex items-start gap-2 text-sm text-ink2">
              <input
                type="checkbox"
                checked={share.shared}
                disabled={shareBusy || busy !== null}
                onChange={(event) => toggleShare(event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-cyan"
              />
              <span>
                {share.shared ? "Partagée avec les autres ✓" : share.stale ? "Partager la nouvelle couverture avec les autres" : "Partager cette couverture avec les autres"}
                <span className="block text-xs text-ink3">
                  {share.shared
                    ? "Proposée sur ce livre à qui le scanne — décoche pour retirer (ceux qui l'ont prise la gardent)."
                    : share.defaultChecked
                      ? "Elle vient d'une source : rien de personnel dessus."
                      : "Vérifie qu'on n'y voit rien de personnel (une main, ton salon…)."}
                </span>
              </span>
            </label>
            {shareError !== null && <ErrorAlert message={shareError} />}
          </div>
        )}

        {showSources && (
          <section className="mt-4" aria-busy={candidates.status === "loading"}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink3">Proposées par les sources</h3>
            <CandidatesBlock
              state={candidates}
              busy={busy !== null}
              onChoose={handleChoose}
              onHide={hideCandidate}
              onRetry={retryCandidates}
              emptyMessage="Aucune source n'a d'autre image pour ce livre."
            />
          </section>
        )}

        {/* Les autres éditions (#277) : proposées, jamais imposées — au tap, avec
            une requête modifiable (le titre résolu est parfois faux). */}
        <section className="mt-4" aria-busy={editions.status === "loading"}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink3">Autres éditions</h3>
          <p className="mt-1 text-xs leading-relaxed text-ink3">
            {showSources
              ? "Réédition, intégrale, collector : la couverture d'une édition sœur, si aucune image ne te convient. Ce ne sera pas exactement la tienne."
              : "Ce livre n'a pas de code-barres : cherche-le par son titre pour lui proposer une couverture."}
          </p>
          <form
            className="mt-2 flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              searchEditions();
            }}
          >
            <input
              value={editionTitle}
              onChange={(event) => {
                queryTouched.current = true;
                setEditionTitle(event.target.value);
              }}
              maxLength={EDITION_QUERY_MAX_LENGTH}
              placeholder="Titre"
              aria-label="Titre à chercher"
              className={INPUT_CLASS}
            />
            <input
              value={editionAuthor}
              onChange={(event) => {
                queryTouched.current = true;
                setEditionAuthor(event.target.value);
              }}
              maxLength={EDITION_QUERY_MAX_LENGTH}
              placeholder="Auteur (facultatif)"
              aria-label="Auteur à chercher"
              className={INPUT_CLASS}
            />
            <Button type="submit" variant="ghost" disabled={busy !== null || editions.status === "loading" || editionTitle.trim() === ""}>
              Chercher
            </Button>
          </form>
          {editions.status !== "idle" && (
            <CandidatesBlock
              state={editions}
              busy={busy !== null}
              onChoose={handleChoose}
              onHide={hideCandidate}
              onRetry={searchEditions}
              emptyMessage="Rien trouvé sous ce titre — essaie le titre original, ou la photo."
            />
          )}
        </section>

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink3">La mienne</h3>
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFileChosen} />
        <input ref={galleryInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChosen} />

        {error && (
          <div className="mt-3">
            <ErrorAlert message={error} />
          </div>
        )}

        <div className="mt-2 flex flex-col gap-2">
          {busy === "upload" ? (
            <p className="py-2 text-center text-sm text-ink2">Envoi de la photo…</p>
          ) : (
            <div className="flex gap-2">
              <Button
                ref={firstActionRef}
                type="button"
                variant="ghost"
                className="flex-1"
                disabled={busy !== null}
                onClick={() => cameraInputRef.current?.click()}
              >
                📷 Prendre une photo
              </Button>
              <Button type="button" variant="ghost" className="flex-1" disabled={busy !== null} onClick={() => galleryInputRef.current?.click()}>
                🖼️ Importer une image
              </Button>
            </div>
          )}

          {state.canReset &&
            (confirmReset ? (
              <div className="flex flex-col gap-2 rounded-xl border border-line bg-card2 p-3">
                <p className="text-xs text-ink2">
                  L&apos;app reprend la main : elle cherchera une couverture chez ses sources et posera ce qu&apos;elle trouve — peut-être rien.
                </p>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" className="flex-1" disabled={busy !== null} onClick={handleReset}>
                    {busy === "reset" ? "Recherche…" : "Oui, revenir à l'automatique"}
                  </Button>
                  <button type="button" disabled={busy !== null} onClick={() => setConfirmReset(false)} className="px-3 text-sm text-ink3">
                    Garder
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => setConfirmReset(true)}
                className="py-2 text-sm text-ink3 underline underline-offset-2 disabled:opacity-50"
              >
                Revenir à l&apos;automatique
              </button>
            ))}

          <Button type="button" variant="ghost" block disabled={busy !== null} onClick={onClose}>
            Fermer
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * La grille de candidates — partagée par « Proposées par les sources » et
 * « Autres éditions » : squelette, hors ligne, erreur + Réessayer, vide,
 * grille avec la présélectionnée marquée, note « certaines sources… ».
 */
function CandidatesBlock({
  state,
  busy,
  onChoose,
  onHide,
  onRetry,
  emptyMessage,
}: {
  state: CandidatesState;
  busy: boolean;
  onChoose: (candidate: CoverCandidate) => void;
  onHide: (url: string) => void;
  onRetry: () => void;
  emptyMessage: string;
}) {
  if (state.status === "loading") {
    return (
      <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-3" aria-hidden>
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-36 animate-pulse rounded-md bg-card2" />
        ))}
      </div>
    );
  }
  if (state.status === "offline") {
    return <p className="mt-2 text-sm text-ink2">Pas de réseau — les sources attendront, la photo reste possible.</p>;
  }
  if (state.status === "error") {
    return (
      <div className="mt-2 flex flex-col gap-2">
        <ErrorAlert message={state.message} />
        <button type="button" onClick={onRetry} className="self-start text-sm text-ink2 underline underline-offset-2">
          Réessayer
        </button>
      </div>
    );
  }
  return (
    <>
      {state.candidates.length === 0 ? (
        <p className="mt-2 text-sm text-ink2">{state.degraded ? "Aucune image reçue — certaines sources n'ont pas répondu." : emptyMessage}</p>
      ) : (
        <ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-3">
          {state.candidates.map((candidate) => (
            <li key={candidate.url}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onChoose(candidate)}
                aria-current={candidate.preselected ? "true" : undefined}
                aria-label={`Choisir : ${candidate.label}`}
                className={`flex w-full flex-col items-center gap-1 rounded-md p-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan disabled:opacity-50 ${
                  candidate.preselected ? "outline outline-2 outline-cyan" : ""
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- candidates jetables, hors optimiseur (#276) */}
                <img
                  src={candidate.url}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={() => onHide(candidate.url)}
                  className="h-36 w-full rounded-md bg-card2 object-cover"
                />
                <span className="line-clamp-2 w-full text-center text-[11px] leading-tight text-ink3">
                  {candidate.preselected ? "★ " : ""}
                  {candidate.label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {state.degraded && (
        <p className="mt-2 text-xs text-ink3">
          Certaines sources n&apos;ont pas répondu.{" "}
          <button type="button" onClick={onRetry} className="underline underline-offset-2">
            Réessayer
          </button>
        </p>
      )}
    </>
  );
}
