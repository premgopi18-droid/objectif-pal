"use client";

import { useState, useTransition } from "react";
import { ErrorAlert } from "@/components/error-alert";
import { CATEGORY_LABELS } from "@/lib/books/categories";
import { saveMonthlyObjective } from "@/lib/goals/actions";
import { SCORING_SCALE } from "@/lib/scoring/scale";
import { ALL_CATEGORIES } from "@/lib/scoring/types";
import type { BookCategory, Month, MonthlyObjective, MonthlyReport } from "@/lib/scoring/types";

/**
 * L'objectif du mois (specs §4.11) : la cible par catégorie, la jauge par
 * catégorie, l'état global. Éditable UNIQUEMENT sur le mois en cours — les
 * mois passés sont figés (le bonus est acquis ou perdu, on ne réécrit pas
 * l'histoire). Les jauges viennent du moteur (`report.objective`), jamais
 * recalculées ici.
 */

type ObjectiveSectionProps = {
  month: Month;
  isCurrentMonth: boolean;
  /** Les cibles déclarées du mois (pour pré-remplir l'éditeur), ou null. */
  objective: MonthlyObjective | null;
  /** La progression dérivée par le moteur — null si aucun objectif déclaré. */
  progress: MonthlyReport["objective"];
};

/** L'état des saisies : une chaîne par catégorie (vide = 0 = non visée). */
type DraftTargets = Record<BookCategory, string>;

const draftFromObjective = (objective: MonthlyObjective | null): DraftTargets =>
  Object.fromEntries(
    ALL_CATEGORIES.map((category) => [category, objective?.[category] ? String(objective[category]) : ""]),
  ) as DraftTargets;

export function ObjectiveSection({ month, isCurrentMonth, objective, progress }: ObjectiveSectionProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<DraftTargets>(() => draftFromObjective(objective));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Rien à montrer sur un mois passé sans objectif : on n'invite pas à
  // réécrire l'histoire.
  if (!isCurrentMonth && progress === null) return null;

  function openEditor() {
    setDraft(draftFromObjective(objective));
    setError(null);
    setIsEditing(true);
  }

  function save() {
    const targets: Partial<Record<BookCategory, number>> = {};
    for (const category of ALL_CATEGORIES) {
      const raw = draft[category].trim();
      const value = raw === "" ? 0 : Number(raw);
      if (!Number.isInteger(value) || value < 0 || value > 99) {
        setError("Chaque cible est un nombre entier entre 0 et 99.");
        return;
      }
      targets[category] = value;
    }
    setError(null);
    startTransition(async () => {
      const result = await saveMonthlyObjective(month, targets);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setIsEditing(false);
    });
  }

  return (
    <section className="rounded-xl border border-foreground/10 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Objectif du mois</h2>
        {isCurrentMonth && !isEditing && (
          <button type="button" onClick={openEditor} className="text-sm font-semibold text-amber-500">
            {progress ? "Modifier" : "Définir"}
          </button>
        )}
      </div>

      {isEditing ? (
        <div className="mt-3 flex flex-col gap-2">
          {ALL_CATEGORIES.map((category) => (
            <label key={category} className="flex items-center justify-between gap-3">
              <span className="text-sm">{CATEGORY_LABELS[category]}</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={99}
                value={draft[category]}
                onChange={(event) => setDraft({ ...draft, [category]: event.target.value })}
                placeholder="0"
                className="w-16 rounded-md border border-foreground/20 bg-transparent p-2 text-center text-sm"
              />
            </label>
          ))}
          <p className="text-xs opacity-60">0 = catégorie non visée. Tout à 0 = pas d&apos;objectif.</p>
          {error && <ErrorAlert message={error} />}
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={isPending}
              className="flex-1 rounded-full border-2 border-amber-500 px-4 py-2 text-sm font-semibold text-amber-500 disabled:opacity-50"
            >
              {isPending ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              disabled={isPending}
              className="flex-1 rounded-full border border-foreground/20 px-4 py-2 text-sm disabled:opacity-50"
            >
              Annuler
            </button>
          </div>
        </div>
      ) : progress ? (
        <div className="mt-3 flex flex-col gap-3">
          {progress.progress.map(({ category, target, finished }) => {
            const ratio = Math.min(1, finished / target);
            return (
              <div key={category}>
                <div className="flex items-baseline justify-between text-sm">
                  <span>{CATEGORY_LABELS[category]}</span>
                  <span className="font-mono">
                    {finished} / {target}
                  </span>
                </div>
                {/* La jauge : purement décorative, le ratio est déjà en texte. */}
                <div aria-hidden className="mt-1 h-2 rounded-full bg-foreground/10">
                  <div
                    className={`h-full rounded-full ${finished >= target ? "bg-amber-500" : "bg-amber-500/50"}`}
                    style={{ width: `${ratio * 100}%` }}
                  />
                </div>
              </div>
            );
          })}
          <p className={`text-sm font-semibold ${progress.achieved ? "text-amber-500" : "opacity-70"}`}>
            {progress.achieved
              ? `Objectif atteint : bonus +${SCORING_SCALE.objectiveBonus} !`
              : isCurrentMonth
                ? `En cours — bonus +${SCORING_SCALE.objectiveBonus} si toutes les cibles sont atteintes.`
                : "Objectif manqué — pas de bonus."}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-sm opacity-70">
          Pas d&apos;objectif ce mois-ci. Une cible par catégorie, un bonus +{SCORING_SCALE.objectiveBonus} si tout
          est atteint.
        </p>
      )}
    </section>
  );
}
