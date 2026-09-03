"use client";

import { useEffect, useMemo, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { CardComposer } from "@/components/share/card-composer";
import { Toast } from "@/components/ui/toast";
import { CATEGORY_LABELS } from "@/lib/books/categories";
import { localCurrentMonth } from "@/lib/dates";
import { SCORING_SCALE } from "@/lib/scoring/scale";
import { formatPoints } from "@/lib/scoring/report-text";
import { ALL_CATEGORIES } from "@/lib/scoring/types";
import type { BookCategory, MonthlyObjective } from "@/lib/scoring/types";
import { deriveShareCardData } from "@/lib/share/card-data";
import { buildGuestReport, type GuestCounts } from "@/lib/share/guest-report";

/**
 * La carte d'invité (§4.15) — le formulaire du live : nom, photo, compteurs
 * par catégorie, objectifs facultatifs. Le score sort du VRAI moteur (via
 * `buildGuestReport`), la carte du VRAI composeur — l'invité obtient
 * exactement la carte d'un paliste, sans compte.
 *
 * Tout est local à l'écran : la photo reste un object URL sur l'appareil,
 * rien n'est enregistré nulle part — fermer la page ne laisse aucune trace.
 */

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

const SECTION_LABEL = "text-xs font-extrabold uppercase tracking-[0.1em] text-ink3";
const NUMBER_INPUT =
  "w-16 rounded-xl border border-line bg-card2 p-2 text-center text-sm text-ink tabular-nums " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan";
const TEXT_INPUT =
  "w-full rounded-xl border border-line bg-card2 p-3 text-sm text-ink " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan";

/** Une saisie par catégorie, en chaînes (vide = 0) — même patron que l'éditeur d'objectifs. */
type Drafts = Record<BookCategory, string>;

const emptyDrafts = (): Drafts =>
  Object.fromEntries(ALL_CATEGORIES.map((category) => [category, ""])) as Drafts;

const draftValue = (raw: string): number => (raw.trim() === "" ? 0 : Number(raw));

/** « Léna Décibel » → `lena-decibel` — pour le nom du fichier partagé. */
const fileSlug = (name: string): string =>
  name
    .trim()
    .toLocaleLowerCase("fr-FR")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function GuestCardForm() {
  const [name, setName] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [month, setMonth] = useState(localCurrentMonth);
  const [counts, setCounts] = useState<Drafts>(emptyDrafts);
  const [purchases, setPurchases] = useState("");
  const [targets, setTargets] = useState<Drafts>(emptyDrafts);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // L'object URL de la photo est libéré dès qu'il est remplacé (et au démontage).
  useEffect(() => {
    if (photoUrl === null) return;
    return () => URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);

  function choosePhoto(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setPhotoUrl(URL.createObjectURL(file));
  }

  // Un input `month` effacé (ou non supporté) ne doit pas casser la carte :
  // repli sur le mois courant, comme au chargement.
  const safeMonth = MONTH_PATTERN.test(month) ? month : localCurrentMonth();

  const report = useMemo(() => {
    const finishedByCategory = Object.fromEntries(
      ALL_CATEGORIES.map((category) => [category, draftValue(counts[category])]),
    ) as GuestCounts;
    const objective = Object.fromEntries(
      ALL_CATEGORIES.map((category) => [category, draftValue(targets[category])]),
    ) as MonthlyObjective;
    return buildGuestReport({
      month: safeMonth,
      finishedByCategory,
      unreadPurchaseCount: draftValue(purchases),
      objective,
    });
  }, [safeMonth, counts, purchases, targets]);

  const cardData = useMemo(() => deriveShareCardData(report, name.trim()), [report, name]);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className={SECTION_LABEL}>L&apos;invité</h2>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-ink">Nom affiché sur la carte</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Léna"
            maxLength={40}
            className={TEXT_INPUT}
          />
        </label>
        <div className="flex items-center gap-3">
          {photoUrl !== null && (
            // eslint-disable-next-line @next/next/no-img-element -- object URL local, pas d'optimisation possible
            <img src={photoUrl} alt="Photo choisie" className="size-12 shrink-0 rounded-full object-cover" />
          )}
          <label className="inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-card2 px-4 py-3 text-sm font-bold text-ink transition focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-cyan active:scale-[0.97]">
            <ImagePlus aria-hidden className="size-5" />
            {photoUrl === null ? "Ajouter une photo" : "Changer la photo"}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => {
                choosePhoto(event.target.files);
                // Permet de re-choisir le même fichier après un retrait.
                event.target.value = "";
              }}
            />
          </label>
          {photoUrl !== null && (
            <button
              type="button"
              onClick={() => setPhotoUrl(null)}
              aria-label="Retirer la photo"
              className="grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-card2 text-ink2 transition active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
            >
              <X aria-hidden className="size-5" />
            </button>
          )}
        </div>
        <p className="text-xs text-ink3">
          Sans photo, la carte affiche l&apos;initiale. La photo ne quitte jamais cet appareil.
        </p>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-ink">Mois du bilan</span>
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            className={`${TEXT_INPUT} w-auto`}
          />
        </label>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={SECTION_LABEL}>Lectures terminées dans le mois</h2>
        {ALL_CATEGORIES.map((category) => (
          <label key={category} className="flex items-center justify-between gap-3">
            <span className="text-sm text-ink">
              {CATEGORY_LABELS[category]}
              <span className="ml-1.5 text-[12.5px] text-ink3">
                {formatPoints(SCORING_SCALE.pointsByCategory[category])} pt
              </span>
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={999}
              value={counts[category]}
              onChange={(event) => setCounts({ ...counts, [category]: event.target.value })}
              placeholder="0"
              className={NUMBER_INPUT}
            />
          </label>
        ))}
        <label className="mt-1 flex items-center justify-between gap-3 border-t border-line pt-3">
          <span className="text-sm text-ink">
            Titres achetés non lus
            <span className="ml-1.5 text-[12.5px] text-ink3">
              {formatPoints(SCORING_SCALE.unreadPurchasePenalty)} pt
            </span>
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={999}
            value={purchases}
            onChange={(event) => setPurchases(event.target.value)}
            placeholder="0"
            className={NUMBER_INPUT}
          />
        </label>
      </section>

      <details className="rounded-card border border-line bg-card p-4">
        <summary className="cursor-pointer text-xs font-extrabold uppercase tracking-[0.1em] text-ink3">
          Objectifs du mois (facultatif)
        </summary>
        <div className="mt-3 flex flex-col gap-2">
          {ALL_CATEGORIES.map((category) => (
            <label key={category} className="flex items-center justify-between gap-3">
              <span className="text-sm text-ink">{CATEGORY_LABELS[category]}</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={99}
                value={targets[category]}
                onChange={(event) => setTargets({ ...targets, [category]: event.target.value })}
                placeholder="0"
                className={NUMBER_INPUT}
              />
            </label>
          ))}
          <p className="text-xs text-ink3">
            0 = catégorie non visée. Toutes les cibles atteintes : bonus +{SCORING_SCALE.objectiveBonus}, comme
            dans l&apos;app.
          </p>
        </div>
      </details>

      <p className="text-sm font-bold text-ink">
        Score du mois : <span className="tabular-nums">{formatPoints(report.total)}</span>
        {report.objective?.achieved && (
          <span className="ml-1.5 font-semibold text-green">objectif atteint, bonus inclus ✓</span>
        )}
      </p>

      <section className="flex flex-col gap-2">
        <h2 className={SECTION_LABEL}>La carte</h2>
        <CardComposer
          data={cardData}
          avatarUrl={photoUrl}
          fileName={`objectif-pal-${fileSlug(name) || "invite"}-${safeMonth}.jpg`}
          onToast={setToastMessage}
        />
      </section>

      <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </div>
  );
}
