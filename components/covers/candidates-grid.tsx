"use client";

import { ErrorAlert } from "@/components/error-alert";
import type { CoverCandidate } from "@/lib/covers/candidates";
import type { CandidatesState } from "./use-cover-candidates";

/**
 * La grille de candidates — partagée par « Proposées par les sources » et
 * « Autres éditions » : squelette, hors ligne, erreur + Réessayer, vide,
 * grille avec la présélectionnée marquée, note « certaines sources… ».
 *
 * Les candidates sont des `<img>` bruts, hors `next/image` : une dizaine
 * d'images jetables par ouverture brûleraient les transformations Vercel pour
 * rien — seule la couverture choisie, rapatriée la nuit suivante, repasse par
 * l'optimiseur. Une candidate qui ne charge pas disparaît de la grille.
 */
export function CandidatesGrid({
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
