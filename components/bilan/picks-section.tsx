"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ErrorAlert } from "@/components/error-alert";
import { ALL_PICK_KINDS, PICK_KIND_LABELS, PICK_KIND_MEDALS, type PickKind } from "@/lib/books/pick-kinds";
import { removeMonthlyPick, saveMonthlyPick } from "@/lib/goals/actions";
import type { Month } from "@/lib/scoring/types";

/**
 * Les distinctions du mois (specs §4.4) : trois choix ÉDITORIAUX posés à la
 * main, chacun pointant une lecture terminée du mois affiché, avec un
 * commentaire libre. Posables aussi sur un mois passé (décision du
 * 18/07/2026) : on prépare l'antenne après la clôture.
 * Rhabillage refonte #71 : médaille 🏆🎉💀 + titre + commentaire, aux tokens.
 */

// La médaille de chaque distinction vit désormais dans pick-kinds (#234) —
// la même langue au Bilan, au cercle et sur la carte de paliste.

export type PickSlot = {
  kind: PickKind;
  readingId: string;
  comment: string | null;
};

type PicksSectionProps = {
  month: Month;
  /** Les lectures terminées du mois affiché — les seules candidates. */
  finishedReadings: { readingId: string; title: string }[];
  /** Les distinctions déjà posées pour ce mois. */
  picks: PickSlot[];
};

export function PicksSection({ month, finishedReadings, picks }: PicksSectionProps) {
  const [editingKind, setEditingKind] = useState<PickKind | null>(null);
  const [selectedReadingId, setSelectedReadingId] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const titleOf = (readingId: string) =>
    finishedReadings.find((reading) => reading.readingId === readingId)?.title ?? "(lecture introuvable)";

  function openEditor(kind: PickKind, current: PickSlot | undefined) {
    setEditingKind(kind);
    // Une lecture devenue introuvable (supprimée depuis) ne peut pas être
    // pré-sélectionnée : le <select> n'aurait pas d'option correspondante et
    // « Enregistrer » renverrait un id périmé (review #39).
    const currentIsSelectable = finishedReadings.some((reading) => reading.readingId === current?.readingId);
    setSelectedReadingId(currentIsSelectable ? current!.readingId : (finishedReadings[0]?.readingId ?? ""));
    setComment(current?.comment ?? "");
    setError(null);
  }

  function save(kind: PickKind) {
    if (!selectedReadingId) {
      setError("Choisis une lecture.");
      return;
    }
    startTransition(async () => {
      const result = await saveMonthlyPick(month, kind, selectedReadingId, comment || null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditingKind(null);
    });
  }

  function remove(kind: PickKind) {
    setError(null);
    startTransition(async () => {
      const result = await removeMonthlyPick(month, kind);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditingKind(null);
    });
  }

  return (
    <section className="rounded-card border border-line bg-card p-4">
      <h2 className="text-xs font-extrabold uppercase tracking-[0.1em] text-ink3">Distinctions du mois</h2>
      {/* L'échec muet est interdit : l'erreur d'un « Retirer » (hors éditeur)
          s'affiche ici, au niveau de la section (review #39). */}
      {error && editingKind === null && (
        <div className="mt-2">
          <ErrorAlert message={error} />
        </div>
      )}
      {finishedReadings.length === 0 && picks.length === 0 ? (
        <p className="mt-2 text-sm text-ink2">Termine une lecture ce mois-ci pour poser une distinction.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-4">
          {ALL_PICK_KINDS.map((kind) => {
            const pick = picks.find((candidate) => candidate.kind === kind);
            const isEditing = editingKind === kind;

            if (isEditing) {
              return (
                <li key={kind}>
                  <span className="text-sm text-ink3">{PICK_KIND_LABELS[kind]}</span>
                  <div className="mt-2 flex flex-col gap-2">
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="sr-only">Lecture distinguée</span>
                      <select
                        value={selectedReadingId}
                        onChange={(event) => setSelectedReadingId(event.target.value)}
                        className="rounded-xl border border-line bg-card2 p-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
                      >
                        {finishedReadings.map((reading) => (
                          <option key={reading.readingId} value={reading.readingId}>
                            {reading.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <textarea
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                      placeholder="Un mot pour l'antenne (facultatif)"
                      rows={2}
                      className="rounded-xl border border-line bg-card2 p-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
                    />
                    {error && <ErrorAlert message={error} />}
                    <div className="flex gap-2">
                      <Button variant="grad" onClick={() => save(kind)} disabled={isPending} className="flex-1">
                        {isPending ? "Enregistrement…" : "Enregistrer"}
                      </Button>
                      <Button variant="ghost" onClick={() => setEditingKind(null)} disabled={isPending} className="flex-1">
                        Annuler
                      </Button>
                    </div>
                  </div>
                </li>
              );
            }

            if (pick) {
              return (
                <li key={kind} className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span aria-hidden className="text-xl leading-none">
                      {PICK_KIND_MEDALS[kind]}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm">
                        <span className="font-bold text-ink">{titleOf(pick.readingId)}</span>
                        <span className="text-ink3"> — {PICK_KIND_LABELS[kind]}</span>
                      </p>
                      {pick.comment && <p className="mt-0.5 text-[12.5px] text-ink2">« {pick.comment} »</p>}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-3">
                    <button
                      type="button"
                      onClick={() => openEditor(kind, pick)}
                      disabled={isPending}
                      className="text-sm font-bold text-cyan disabled:opacity-50"
                    >
                      Modifier
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(kind)}
                      disabled={isPending}
                      className="text-sm text-ink3 disabled:opacity-40"
                    >
                      Retirer
                    </button>
                  </div>
                </li>
              );
            }

            return (
              <li key={kind} className="flex items-center justify-between gap-3">
                <span className="text-sm text-ink3">{PICK_KIND_LABELS[kind]}</span>
                <button
                  type="button"
                  onClick={() => openEditor(kind, pick)}
                  disabled={isPending || finishedReadings.length === 0}
                  className="text-sm font-bold text-cyan disabled:opacity-50"
                >
                  Choisir
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
