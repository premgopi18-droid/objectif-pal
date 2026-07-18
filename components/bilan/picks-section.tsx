"use client";

import { useState, useTransition } from "react";
import { ErrorAlert } from "@/components/error-alert";
import { ALL_PICK_KINDS, PICK_KIND_LABELS, type PickKind } from "@/lib/books/pick-kinds";
import { removeMonthlyPick, saveMonthlyPick } from "@/lib/goals/actions";
import type { Month } from "@/lib/scoring/types";

/**
 * Les distinctions du mois (specs §4.4) : trois choix ÉDITORIAUX posés à la
 * main, chacun pointant une lecture terminée du mois affiché, avec un
 * commentaire libre. Posables aussi sur un mois passé (décision du
 * 18/07/2026) : on prépare l'antenne après la clôture.
 */

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
    <section className="rounded-xl border border-foreground/10 p-4">
      <h2 className="font-semibold">Distinctions du mois</h2>
      {/* L'échec muet est interdit : l'erreur d'un « Retirer » (hors éditeur)
          s'affiche ici, au niveau de la section (review #39). */}
      {error && editingKind === null && (
        <div className="mt-2">
          <ErrorAlert message={error} />
        </div>
      )}
      {finishedReadings.length === 0 && picks.length === 0 ? (
        <p className="mt-2 text-sm opacity-70">Termine une lecture ce mois-ci pour poser une distinction.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-4">
          {ALL_PICK_KINDS.map((kind) => {
            const pick = picks.find((candidate) => candidate.kind === kind);
            const isEditing = editingKind === kind;
            return (
              <li key={kind}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm opacity-70">{PICK_KIND_LABELS[kind]}</span>
                  {!isEditing && (
                    <div className="flex shrink-0 gap-3">
                      <button
                        type="button"
                        onClick={() => openEditor(kind, pick)}
                        disabled={isPending || finishedReadings.length === 0}
                        className="text-sm font-semibold text-amber-500 disabled:opacity-50"
                      >
                        {pick ? "Modifier" : "Choisir"}
                      </button>
                      {pick && (
                        <button
                          type="button"
                          onClick={() => remove(kind)}
                          disabled={isPending}
                          className="text-sm opacity-60 disabled:opacity-30"
                        >
                          Retirer
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {isEditing ? (
                  <div className="mt-2 flex flex-col gap-2">
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="sr-only">Lecture distinguée</span>
                      <select
                        value={selectedReadingId}
                        onChange={(event) => setSelectedReadingId(event.target.value)}
                        className="rounded-md border border-foreground/20 bg-transparent p-2 text-sm"
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
                      className="rounded-md border border-foreground/20 bg-transparent p-2 text-sm"
                    />
                    {error && <ErrorAlert message={error} />}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => save(kind)}
                        disabled={isPending}
                        className="flex-1 rounded-full border-2 border-amber-500 px-4 py-2 text-sm font-semibold text-amber-500 disabled:opacity-50"
                      >
                        {isPending ? "Enregistrement…" : "Enregistrer"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingKind(null)}
                        disabled={isPending}
                        className="flex-1 rounded-full border border-foreground/20 px-4 py-2 text-sm disabled:opacity-50"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                ) : pick ? (
                  <p className="mt-1">
                    <span className="font-medium">{titleOf(pick.readingId)}</span>
                    {pick.comment && <span className="opacity-70"> — {pick.comment}</span>}
                  </p>
                ) : (
                  <p className="mt-1 text-sm opacity-50">Aucune pour l&apos;instant.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
