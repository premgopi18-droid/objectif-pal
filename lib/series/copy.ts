import { formatDateFrench } from "@/lib/dates";
import type { BookCategory } from "@/lib/scoring/types";
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
export function seriesCountsText(progress: Pick<SeriesProgress, "read" | "pile" | "totalVolumes" | "isOngoing" | "missing">): string {
  const parts = [plural(progress.read, "lu")];
  if (progress.pile > 0) parts.push(`${progress.pile} dans la pile`);
  // Le troisième état (lu · dans la pile · pas possédé) dès qu'un total OU un plancher dit ce qui existe (#307).
  if (progress.missing !== null && progress.missing > 0) parts.push(`${progress.missing} pas possédé${progress.missing > 1 ? "s" : ""}`);
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
  progress: Pick<SeriesProgress, "totalVolumes" | "isOngoing" | "factDeclaredBy" | "factDeclaredAt" | "factSource">,
  declarerLabel: string | null,
): string | null {
  if (progress.factDeclaredAt === null) return null;
  // Le fait posé par la synchronisation GCD (série close / en cours chez GCD, décision du 14/09/2026) :
  // on dit d'où il vient, et il se corrige d'un tap comme les autres.
  if (progress.factSource === "gcd") {
    return progress.isOngoing ? "parution en cours d'après GCD" : `${progress.totalVolumes} numéros, série close d'après GCD`;
  }
  // AniList (#304) : l'œuvre japonaise — une édition française normale partage son découpage.
  if (progress.factSource === "anilist") {
    return progress.isOngoing ? "parution en cours d'après AniList" : `${progress.totalVolumes} volumes, série terminée d'après AniList`;
  }
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

/**
 * Pourquoi aucune source ne connaît la série — mesuré le 14/09/2026 (#307) :
 * aucune source ouverte ne décrit les parutions françaises des romans, et
 * Panini n'est pas indexé par ISBN dans GCD. Le dire vaut mieux qu'un silence.
 */
export function sourcelessReason(context: { category: BookCategory; publisher: string | null }): string | null {
  if (context.category === "roman") return "aucune source ouverte ne décrit les parutions françaises des romans";
  if (context.publisher !== null && /panini/i.test(context.publisher)) return "GCD n'indexe pas les parutions Panini";
  return null;
}

/** La mention sous le stepper — les planchers vivants, ou leur absence (et sa raison), jamais une vérité. */
export function knownMaxHint(knownMax: readonly KnownMax[], context?: { category: BookCategory; publisher: string | null }): string {
  if (knownMax.length === 0) {
    const reason = context ? sourcelessReason(context) : null;
    return reason === null
      ? "Aucune source ne connaît cette série : à toi de dire."
      : `Aucune source ne connaît cette série (${reason}) : à toi de dire.`;
  }
  return `${knownMax.map(knownMaxLine).join(" · ")}.`;
}

/** La ligne sous les compteurs de la fiche : d'où vient ce que la grille sait, sans total déclaré (#307). */
export function knownMaxSummary(knownMax: readonly KnownMax[]): string | null {
  if (knownMax.length === 0) return null;
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
