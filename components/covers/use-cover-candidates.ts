import { useCallback, useEffect, useRef, useState } from "react";
import { getCoverCandidates, searchEditionCovers, type CoverCandidatesActionResult } from "@/lib/books/cover-choice-actions";
import { NETWORK_ERROR_MESSAGE } from "@/lib/books/errors";
import type { CoverCandidate } from "@/lib/covers/candidates";
import { authorForSearch } from "@/lib/covers/edition-query";

/**
 * Les candidates de la feuille (audit #274, sorti de `cover-chooser-sheet.tsx`) :
 * les **sources** (#276 — chargées à l'ouverture, en parallèle, sous quota) et
 * les **autres éditions** (#277 — au tap seulement, requête modifiable, jamais
 * posées toutes seules). Le hook possède les deux états et la requête ; la
 * feuille ne fait que les afficher.
 */

export type CandidatesState =
  | { status: "loading" }
  | { status: "offline" }
  | { status: "error"; message: string }
  | { status: "ready"; candidates: CoverCandidate[]; degraded: boolean };

/** Les autres éditions : rien tant qu'on n'a pas tapé « Chercher ». */
export type EditionsState = { status: "idle" } | CandidatesState;

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

const toCandidatesState = (result: CoverCandidatesActionResult): CandidatesState =>
  result.ok ? { status: "ready", candidates: result.candidates, degraded: result.degraded } : { status: "error", message: result.error };

export function useCoverCandidates(initial: { bookId: string; title: string; authors: string | null }) {
  const { bookId } = initial;
  // Hors ligne, on le dit tout de suite au lieu de charger dans le vide — décidé
  // à l'ouverture (la feuille n'est jamais rendue côté serveur : `book` y est nul).
  const [candidates, setCandidates] = useState<CandidatesState>(() => (isOffline() ? { status: "offline" } : { status: "loading" }));
  const [editions, setEditions] = useState<EditionsState>({ status: "idle" });
  /** La requête d'éditions (#277) : pré-remplie depuis le livre, MODIFIABLE. */
  const [editionTitle, setEditionTitle] = useState(initial.title);
  const [editionAuthor, setEditionAuthor] = useState(authorForSearch(initial.authors) ?? "");
  /** Vrai dès que l'utilisateur a touché la requête : la relecture en base ne l'écrase plus. */
  const queryTouched = useRef(false);

  // Les candidates (#276) : à la demande, à l'ouverture — jamais au scan. Le
  // résultat arrive en `.then` (asynchrone) : rien n'est posé pendant l'effet.
  const fetchCandidates = useCallback(
    (id: string) =>
      getCoverCandidates(id)
        .then((result) => setCandidates(toCandidatesState(result)))
        .catch(() => setCandidates({ status: "error", message: NETWORK_ERROR_MESSAGE })),
    [],
  );

  useEffect(() => {
    if (isOffline()) return;
    fetchCandidates(bookId);
  }, [bookId, fetchCandidates]);

  /** « Réessayer » : repasse en chargement puis relance — un tap, pas un effet. */
  const retryCandidates = () => {
    setCandidates({ status: "loading" });
    fetchCandidates(bookId);
  };

  /** « Chercher d'autres éditions » (#277) : au tap seulement, jamais à l'ouverture. */
  const searchEditions = () => {
    if (isOffline()) {
      setEditions({ status: "offline" });
      return;
    }
    setEditions({ status: "loading" });
    searchEditionCovers(bookId, { title: editionTitle, author: editionAuthor.trim() === "" ? null : editionAuthor })
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

  const editTitle = (value: string) => {
    queryTouched.current = true;
    setEditionTitle(value);
  };
  const editAuthor = (value: string) => {
    queryTouched.current = true;
    setEditionAuthor(value);
  };

  /** La fiche relue en base : la requête d'éditions la suit tant que l'utilisateur n'y a pas touché. */
  const syncQueryFromFacts = useCallback((title: string, authors: string | null) => {
    if (queryTouched.current) return;
    setEditionTitle(title);
    setEditionAuthor(authorForSearch(authors) ?? "");
  }, []);

  return { candidates, editions, editionTitle, editionAuthor, editTitle, editAuthor, retryCandidates, searchEditions, hideCandidate, syncQueryFromFacts };
}
