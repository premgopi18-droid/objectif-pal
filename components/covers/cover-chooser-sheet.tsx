"use client";

import { useEffect, useRef, useState } from "react";
import { BookCover } from "@/components/book-cover";
import { ErrorAlert } from "@/components/error-alert";
import { Button } from "@/components/ui/button";
import { getCoverState } from "@/lib/books/cover-actions";
import { EDITION_QUERY_MAX_LENGTH } from "@/lib/covers/edition-query";
import { deriveCoverSheetState } from "@/lib/covers/sheet-state";
import { CandidatesGrid } from "./candidates-grid";
import { coverSheetBookFromFacts, type CoverSheetBook } from "./cover-sheet-book";
import { useCoverCandidates } from "./use-cover-candidates";
import { useCoverMutations } from "./use-cover-mutations";
import { useCoverShare } from "./use-cover-share";

export type { CoverSheetBook } from "./cover-sheet-book";

/**
 * La feuille « Changer la couverture » (#275, epic #274) — LE lieu unique du
 * choix : couverture actuelle et son origine, les **candidates** de toutes les
 * sources (#276), les **autres éditions** (#277), le partage au pool (#278),
 * photo ou import galerie, et « Revenir à l'automatique » quand un choix existe.
 *
 * Depuis l'audit #274, la feuille n'est plus que l'ASSEMBLAGE : chaque famille
 * de gestes vit dans son hook (`useCoverCandidates`, `useCoverShare`,
 * `useCoverMutations`), la grille dans `CandidatesGrid` — ce fichier ne
 * contient que ce qui se voit.
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

type CoverChooserSheetProps = {
  book: CoverSheetBook | null;
  onClose: () => void;
  /** La couverture a changé : le parent met sa liste à jour (la vignette suit tout de suite). */
  onChanged: (bookId: string, cover: { coverUrl: string | null; coverChosenAt: string | null }) => void;
};

const INPUT_CLASS =
  "min-w-0 flex-1 rounded-xl border border-line bg-card2 px-3 py-2 text-sm text-ink placeholder:text-ink3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan";

export function CoverChooserSheet({ book, onClose, onChanged }: CoverChooserSheetProps) {
  if (!book) return null;
  // `key` sur le livre : ré-ouvrir sur un autre livre remonte un corps neuf
  // (erreur, confirmation, envoi repartent propres) — sans effet ni setState.
  return <SheetBody key={book.bookId} book={book} onClose={onClose} onChanged={onChanged} />;
}

function SheetBody({ book: initial, onClose, onChanged }: CoverChooserSheetProps & { book: CoverSheetBook }) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);
  /** L'état affiché : ce que l'appelant savait, puis la vérité relue en base. */
  const [book, setBook] = useState<CoverSheetBook>(initial);
  const sources = useCoverCandidates({ bookId: initial.bookId, title: initial.title, authors: initial.authors ?? null });
  const sharing = useCoverShare(book, setBook);
  const { busy, error, success, confirmReset, setConfirmReset, chooseCandidate, uploadFile, resetToAutomatic } = useCoverMutations({
    book,
    setBook,
    onChanged,
    onChosen: sources.hideCandidate,
  });

  // À l'ouverture : le focus entre dans le dialogue (a11y, review #280), et
  // l'état réel est relu — une réponse en échec laisse l'état initial, le
  // geste reste possible (le serveur re-vérifie de toute façon).
  // CONTRAT (review #288) : les deux callbacks sont stables par construction
  // (`useCallback` sans dépendance changeante) — l'effet ne rejoue qu'au
  // changement de livre, jamais après un geste. Une dépendance ajoutée dans
  // l'un des hooks le ferait rejouer à chaque couverture posée (refocus,
  // relecture, re-partage) sans que le lint ne dise rien.
  const { syncQueryFromFacts } = sources;
  const { autoShareIfDefault } = sharing;
  useEffect(() => {
    firstActionRef.current?.focus();
    let cancelled = false;
    getCoverState(initial.bookId)
      .then((facts) => {
        if (cancelled || !facts.ok) return;
        setBook(coverSheetBookFromFacts(initial.bookId, facts));
        syncQueryFromFacts(facts.title, facts.authors);
        autoShareIfDefault(initial.bookId, facts, () => cancelled);
      })
      .catch(() => {
        // Serveur injoignable : on reste sur ce que l'appelant savait.
      });
    return () => {
      cancelled = true;
    };
  }, [initial.bookId, syncQueryFromFacts, autoShareIfDefault]);

  // Échap ferme (sauf pendant un envoi : on ne laisse pas un upload orphelin).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && busy === null) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const state = deriveCoverSheetState({ coverUrl: book.coverUrl, coverChosenAt: book.coverChosenAt });
  const { share } = sharing;

  const onFileChosen = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // La même photo doit pouvoir être re-choisie après une erreur.
    event.target.value = "";
    if (file) uploadFile(file);
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
                disabled={sharing.shareBusy || busy !== null}
                onChange={(event) => sharing.toggleShare(event.target.checked)}
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
            {sharing.shareError !== null && <ErrorAlert message={sharing.shareError} />}
          </div>
        )}

        {showSources && (
          <section className="mt-4" aria-busy={sources.candidates.status === "loading"}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink3">Proposées par les sources</h3>
            <CandidatesGrid
              state={sources.candidates}
              busy={busy !== null}
              onChoose={chooseCandidate}
              onHide={sources.hideCandidate}
              onRetry={sources.retryCandidates}
              emptyMessage="Aucune source n'a d'autre image pour ce livre."
            />
          </section>
        )}

        {/* Les autres éditions (#277) : proposées, jamais imposées — au tap, avec
            une requête modifiable (le titre résolu est parfois faux). */}
        <section className="mt-4" aria-busy={sources.editions.status === "loading"}>
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
              sources.searchEditions();
            }}
          >
            <input
              value={sources.editionTitle}
              onChange={(event) => sources.editTitle(event.target.value)}
              maxLength={EDITION_QUERY_MAX_LENGTH}
              placeholder="Titre"
              aria-label="Titre à chercher"
              className={INPUT_CLASS}
            />
            <input
              value={sources.editionAuthor}
              onChange={(event) => sources.editAuthor(event.target.value)}
              maxLength={EDITION_QUERY_MAX_LENGTH}
              placeholder="Auteur (facultatif)"
              aria-label="Auteur à chercher"
              className={INPUT_CLASS}
            />
            <Button
              type="submit"
              variant="ghost"
              disabled={busy !== null || sources.editions.status === "loading" || sources.editionTitle.trim() === ""}
            >
              Chercher
            </Button>
          </form>
          {sources.editions.status !== "idle" && (
            <CandidatesGrid
              state={sources.editions}
              busy={busy !== null}
              onChoose={chooseCandidate}
              onHide={sources.hideCandidate}
              onRetry={sources.searchEditions}
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
                  <Button type="button" variant="ghost" className="flex-1" disabled={busy !== null} onClick={resetToAutomatic}>
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
