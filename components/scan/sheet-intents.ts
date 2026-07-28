import { SCORING_SCALE } from "@/lib/scoring/scale";
import type { ScanIntent } from "@/lib/books/scan-inbox";

/**
 * Les intentions de la feuille d'actions du scan simple (#165, specs §4.1) —
 * la logique PURE, hors React, testable sous Vitest (environnement node).
 *
 * Les clés reprennent celles de la rafale (`ScanIntent`, §4.13) + `start` :
 * la feuille et la rafale parlent la même langue, et ne peuvent plus diverger
 * silencieusement (test de cohérence sur `INTENT_LABELS`).
 */

export type SheetIntent = ScanIntent | "start";

/** Le malus affiché vient du barème — jamais recopié en dur (CLAUDE.md). */
const PENALTY_POINTS = Math.abs(SCORING_SCALE.unreadPurchasePenalty);

export type SheetIntentConfig = {
  /** Le libellé de la carte radio. */
  label: string;
  /** Le sous-titre de la carte — ce que le geste fait, en une ligne. */
  hint: string;
  /**
   * La note contextuelle affichée sous les choix. CHAQUE intention en a une :
   * pour l'information, et pour que la hauteur de la feuille ne saute pas
   * quand on change d'intention (stabilité de layout, #165).
   */
  note: string;
  /** Le libellé du champ date — le champ « à quatre sens muets » n'existe plus. */
  dateLabel: string;
  /** Vrai pour l'étagère d'avant l'app (§4.13) : on n'invente pas une date inconnue. */
  dateOptional: boolean;
  /** Le libellé du bouton de validation — il répète l'intention, toujours. */
  cta: string;
};

/** L'ordre d'affichage : le quotidien d'abord, le rattrapage ensuite. `start` en tête = la pré-sélection. */
export const SHEET_INTENT_ORDER: readonly SheetIntent[] = ["start", "purchase", "own", "own_read", "read"];

export const SHEET_INTENTS: Record<SheetIntent, SheetIntentConfig> = {
  start: {
    label: "Je commence la lecture",
    hint: "Lance juste une lecture — n'ajoute rien à la PAL ni à la Biblio",
    // Décision du 28/07/2026 : « Commencer » ne fait qu'UNE chose, et le dit.
    note: "Ne fait que ça : créer la lecture. Déjà dans ta PAL ou ta Biblio ? Rien d'autre ne bouge.",
    dateLabel: "Commencé le",
    dateOptional: false,
    cta: "Commencer la lecture",
  },
  purchase: {
    label: `J'achète · −${PENALTY_POINTS} pt`,
    hint: "Le retour de librairie — il entre dans la pile",
    note: `−${PENALTY_POINTS} point immédiat, effacé si tu le termines dans le mois.`,
    dateLabel: "Acheté le",
    dateOptional: false,
    cta: `Enregistrer l'achat · −${PENALTY_POINTS} pt`,
  },
  own: {
    label: "Je le possède déjà",
    hint: "L'étagère d'avant l'app — entre dans la pile",
    note: "Aucun effet sur le score — avec une date, l'entrée alimente la courbe de PAL.",
    dateLabel: "À moi depuis",
    dateOptional: true,
    cta: "Ajouter à ma bibliothèque",
  },
  own_read: {
    label: "Possédé, déjà lu",
    hint: "À moi et déjà terminé — va en Biblio, pas en PAL",
    note: "Date connue : les points tombent dans le bilan de ce mois-là. Sans date : aucun point.",
    dateLabel: "Terminé le",
    dateOptional: true,
    cta: "Marquer comme lu",
  },
  read: {
    label: "Lu — emprunt",
    hint: "Médiathèque, prêt — je ne le possède pas",
    note: "Aucune possession — le livre n'entre jamais dans la pile.",
    dateLabel: "Terminé le",
    dateOptional: true,
    cta: "Enregistrer la lecture (emprunt)",
  },
};

/**
 * La date réellement soumise : nulle SEULEMENT quand le geste autorise le
 * facultatif ET que l'utilisateur a déclaré la date inconnue. Pour une
 * intention à date obligatoire, une case résiduelle est ignorée — la garde,
 * pas l'UI, décide.
 */
export const submittedDate = (intent: SheetIntent, date: string, dateUnknown: boolean): string | null =>
  SHEET_INTENTS[intent].dateOptional && dateUnknown ? null : date;

/**
 * Le libellé du CTA — « Oui, je le relis » remplace UNIQUEMENT celui de
 * `start` quand le livre a déjà été terminé (§4.2) : le bouton devient la
 * réponse explicite à la bannière, les autres intentions ne changent pas.
 */
export const ctaLabel = (intent: SheetIntent, isRereadingPrompt: boolean): string =>
  intent === "start" && isRereadingPrompt ? "Oui, je le relis" : SHEET_INTENTS[intent].cta;
