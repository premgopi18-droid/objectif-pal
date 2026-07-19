"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
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
 * recalculées ici. Rhabillage refonte #71 : jauges en dégradé, tokens.
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
    <section className="rounded-card border border-line bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-extrabold uppercase tracking-[0.1em] text-ink3">Objectif du mois</h2>
        {isCurrentMonth && !isEditing && (
          <button type="button" onClick={openEditor} className="text-sm font-bold text-cyan">
            {progress ? "Modifier" : "Définir"}
          </button>
        )}
      </div>

      {isEditing ? (
        <div className="mt-3 flex flex-col gap-2">
          {ALL_CATEGORIES.map((category) => (
            <label key={category} className="flex items-center justify-between gap-3">
              <span className="text-sm text-ink">{CATEGORY_LABELS[category]}</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={99}
                value={draft[category]}
                onChange={(event) => setDraft({ ...draft, [category]: event.target.value })}
                placeholder="0"
                className="w-16 rounded-xl border border-line bg-card2 p-2 text-center text-sm text-ink tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
              />
            </label>
          ))}
          <p className="text-xs text-ink3">0 = catégorie non visée. Tout à 0 = pas d&apos;objectif.</p>
          {error && <ErrorAlert message={error} />}
          <div className="mt-1 flex gap-2">
            <Button variant="grad" onClick={save} disabled={isPending} className="flex-1">
              {isPending ? "Enregistrement…" : "Enregistrer"}
            </Button>
            <Button variant="ghost" onClick={() => setIsEditing(false)} disabled={isPending} className="flex-1">
              Annuler
            </Button>
          </div>
        </div>
      ) : progress ? (
        <div className="mt-3 flex flex-col gap-3">
          {progress.progress.map(({ category, target, finished }) => {
            const ratio = Math.min(1, finished / target);
            const reached = finished >= target;
            return (
              <div key={category}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-ink">{CATEGORY_LABELS[category]}</span>
                  <span className="tabular-nums text-ink2">
                    {finished} / {target}
                  </span>
                </div>
                {/* La jauge en dégradé (design-specs §5) : décorative, le ratio est déjà en texte. */}
                <div aria-hidden className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-card2">
                  <div
                    className={`h-full rounded-full bg-grad ${reached ? "" : "opacity-60"}`}
                    style={{ width: `${ratio * 100}%` }}
                  />
                </div>
              </div>
            );
          })}
          <p className={`text-sm font-bold ${progress.achieved ? "text-green" : "text-ink2"}`}>
            {progress.achieved
              ? `Objectif atteint : bonus +${SCORING_SCALE.objectiveBonus} !`
              : isCurrentMonth
                ? `En cours — bonus +${SCORING_SCALE.objectiveBonus} si toutes les cibles sont atteintes.`
                : "Objectif manqué — pas de bonus."}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-sm text-ink2">
          Pas d&apos;objectif ce mois-ci. Une cible par catégorie, un bonus +{SCORING_SCALE.objectiveBonus} si tout
          est atteint.
        </p>
      )}
    </section>
  );
}
