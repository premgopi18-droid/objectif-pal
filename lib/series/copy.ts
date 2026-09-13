import { formatDateFrench } from "@/lib/dates";
import type { KnownMax, SeriesNext, SeriesProgress, SeriesStatus } from "@/lib/series/derive-series";

/**
 * Les textes du suivi de séries (lot B de l'epic #289, specs §4.17) — la
 * partie PURE, testée : libellés d'état, ligne de compteurs, carte « à lire
 * ensuite », auteur du fait. Rien d'autre : le composant pose, ne formule pas.
 */

export type SeriesStatusBadge = "reading" | "done" | "idle" | "abandoned";

/** Le badge d'état — les cinq états de §4.17-7, dans le vêtement de `Badge`. */
export const SERIES_STATUS_LABELS: Record<SeriesStatus, { label: string; badge: SeriesStatusBadge }> = {
  "in-progress": { label: "En cours", badge: "reading" },
  "up-to-date": { label: "À jour", badge: "done" },
  complete: { label: "Complète ✓", badge: "done" },
  "unknown-total": { label: "Total à déclarer", badge: "idle" },
  approximate: { label: "≈ approximatif", badge: "abandoned" },
};

/** Les chips du segment — « En cours » regroupe ce qui reste à lire OU à renseigner (proto). */
export type SeriesFilter = "all" | "in-progress" | "up-to-date" | "complete";

export const SERIES_FILTER_LABELS: Record<SeriesFilter, string> = {
  all: "Toutes",
  "in-progress": "En cours",
  "up-to-date": "À jour",
  complete: "Complètes",
};

export const matchesSeriesFilter = (status: SeriesStatus, filter: SeriesFilter): boolean => {
  if (filter === "all") return true;
  if (filter === "in-progress") return status === "in-progress" || status === "unknown-total" || status === "approximate";
  return status === filter;
};

const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
  `${count} ${count > 1 ? pluralForm : singular}`;

/** « 8 lus · 2 dans la pile · sur 12 » / « parution en cours » / « total ? ». */
export function seriesCountsText(progress: Pick<SeriesProgress, "read" | "pile" | "totalVolumes" | "isOngoing">): string {
  const parts = [plural(progress.read, "lu")];
  if (progress.pile > 0) parts.push(`${progress.pile} dans la pile`);
  if (progress.totalVolumes !== null) parts.push(`sur ${progress.totalVolumes}`);
  else if (progress.isOngoing) parts.push("parution en cours");
  else parts.push("total ?");
  return parts.join(" · ");
}

/** Le bandeau de synthèse du segment. */
export function seriesHeadline(seriesCount: number, debt: number): string {
  const series = plural(seriesCount, "série");
  if (debt === 0) return `${series} · rien à lire dans la pile`;
  return `${series} · dette totale : ${plural(debt, "tome")} à lire`;
}

export type NextCardCopy = { tone: "read" | "buy" | "calm"; icon: string; title: string; body: string };

/** La carte « à lire ensuite » de la fiche, dans ses quatre formes (§4.17-8). */
export function nextCardCopy(next: SeriesNext, totalVolumes: number | null): NextCardCopy {
  switch (next.kind) {
    case "read-next":
      return { tone: "read", icon: "📖", title: `À lire ensuite : tome ${next.number}`, body: "Il est déjà dans ta pile." };
    case "missing":
      return {
        tone: "buy",
        icon: "🛒",
        title: `Il te manque le tome ${next.number}`,
        body: "Le prochain à lire n'est pas dans ta bibliothèque.",
      };
    case "up-to-date":
      return { tone: "calm", icon: "🌿", title: "À jour de ta pile", body: "Tout ce que tu possèdes est lu — on guette la suite." };
    case "complete":
      return {
        tone: "calm",
        icon: "🏁",
        title: "Série complète",
        body: totalVolumes === null ? "Tous les tomes sont lus. Chapeau." : `Les ${totalVolumes} tomes sont lus. Chapeau.`,
      };
  }
}

/** L'avertissement quand un tome lu n'a pas de numéro : muet plutôt que faux. */
export function approximateWarning(unnumberedRead: number): string {
  return `≈ ${plural(unnumberedRead, "tome lu sans numéro", "tomes lus sans numéro")} — la jauge et le tome suivant restent muets plutôt que faux. Un tap sur la case « ? » règle ça.`;
}

/**
 * Qui a déclaré le total, et quand — le pseudo n'est servi qu'au cercle
 * (règle de `get_cover_contributions`) : « toi », un ami par son pseudo, sinon
 * « un membre ».
 */
export function declaredByLabel(
  progress: Pick<SeriesProgress, "totalVolumes" | "isOngoing" | "factDeclaredBy" | "factDeclaredAt">,
  declarerLabel: string | null,
): string | null {
  if (progress.factDeclaredAt === null) return null;
  const what = progress.isOngoing ? "parution en cours" : `${progress.totalVolumes} tomes`;
  const who = declarerLabel ?? "un membre";
  // Découpage pur de l'ISO (jour UTC) : le même rendu serveur et client, pas
  // de décalage d'hydratation autour de minuit (review #296).
  const when = formatDateFrench(progress.factDeclaredAt.slice(0, 10));
  return `${what}, déclaré par ${who} le ${when}`;
}

/** Le pré-remplissage du stepper : le plus grand plancher s'il existe, sinon le plus grand possédé (au moins 10, comme le proto). */
export function suggestedTotal(progress: Pick<SeriesProgress, "knownMax" | "gridMax" | "readNumbers" | "pileNumbers">): number {
  const ownedMax = Math.max(0, ...progress.readNumbers, ...progress.pileNumbers);
  const top = progress.knownMax[0]?.value ?? null;
  return Math.max(top ?? 0, ownedMax, top === null ? 10 : 1);
}

/** Une ligne par plancher — GCD (VO) ou une édition déposée à la BnF (VF, #299). */
export function knownMaxLine(known: KnownMax): string {
  if (known.source === "gcd") return `${known.value} numéros parus d'après GCD (au moins)`;
  return `${known.value} tomes déposés à la BnF pour l'édition ${known.label ?? "française"}`;
}

/** La mention sous le stepper — les planchers vivants, ou leur absence, jamais une vérité. */
export function knownMaxHint(knownMax: readonly KnownMax[]): string {
  if (knownMax.length === 0) return "Aucune source ne connaît cette série : à toi de dire.";
  return `${knownMax.map(knownMaxLine).join(" · ")}.`;
}

/** Le libellé de la source d'un plancher qui dépasse le total déclaré : « GCD en connaît 15 » / « La BnF en connaît 112 ». */
export function knownMaxExceedsLabel(known: KnownMax): string {
  return `${known.source === "gcd" ? "GCD" : "La BnF"} en connaît ${known.value}.`;
}

/** Les toasts des trois gestes — accordés au fait réel. */
export const seriesToasts = {
  totalDeclared: (name: string, total: number) => `✓ ${name} : ${plural(total, "tome")} — jauge à jour`,
  ongoingDeclared: (name: string) => `✓ ${name} : parution en cours`,
  volumeNumbered: (number: string) => `✓ Tome ${number} — progression recalculée`,
  /** `tomes` = lus + dans la pile, ce que la carte compte (review #296 : pas « lus »). */
  merged: (name: string, tomes: number) => `✓ Séries fusionnées — ${name} : ${plural(tomes, "tome")}`,
  renamed: (name: string) => `✓ Série renommée : ${name}`,
};
