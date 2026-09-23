/**
 * L'haptique de la rafale (fluidité #332, item 8) : en scan d'étagère, les
 * yeux sont sur les livres, pas sur l'écran — une vibration courte dit « lu »,
 * une autre dit ce qu'est devenue la ligne (ajouté, doublon, à compléter,
 * erreur). Aucun son.
 *
 * Réglage « Vibrations » (Profil › Réglages), actif par défaut, en
 * `localStorage` : donnée d'UX, pas métier (même patron que la série
 * mémorisée, lib/books/last-series.ts). Sans `navigator.vibrate` (iOS Safari
 * ne l'expose pas) : silence, sans erreur.
 *
 * Chrome bloque `vibrate` (silencieusement) tant que l'utilisateur n'a pas encore
 * interagi avec la page : une session de rafale RESTAURÉE au chargement (#131)
 * peut relire un code avant tout tap — la première secousse est alors perdue,
 * sans erreur. Bénin, connu (review #347).
 */
export const HAPTICS_STORAGE_KEY = "scan-haptics";

export type HapticCue = "read" | "added" | "duplicate" | "inbox" | "error";

/** Les motifs, en ms — courts, distincts au poignet sans regarder. */
export const HAPTIC_PATTERNS: Record<HapticCue, number[]> = {
  read: [30],
  added: [20],
  duplicate: [20, 60, 20],
  inbox: [80],
  error: [40, 60, 40, 60, 40],
};

/** `localStorage` peut être absent (SSR) ou interdit (navigation privée). */
function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function isHapticsEnabled(): boolean {
  return storage()?.getItem(HAPTICS_STORAGE_KEY) !== "off";
}

export function setHapticsEnabled(enabled: boolean): void {
  try {
    if (enabled) storage()?.removeItem(HAPTICS_STORAGE_KEY);
    else storage()?.setItem(HAPTICS_STORAGE_KEY, "off");
  } catch {
    // Stockage refusé : le réglage ne survit pas à la session, sans gravité.
  }
}

/** Vibre selon le motif, si l'appareil sait et si l'utilisateur veut. Rend vrai si une vibration est partie. */
export function vibrate(cue: HapticCue): boolean {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
  if (!isHapticsEnabled()) return false;
  try {
    return navigator.vibrate(HAPTIC_PATTERNS[cue]) === true;
  } catch {
    return false;
  }
}
