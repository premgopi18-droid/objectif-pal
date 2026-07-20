import type { BurstItem } from "./burst-mode";
import type { ScanIntent } from "@/lib/books/scan-inbox";

/**
 * La session de rafale survit à la navigation (#131).
 *
 * Aller compléter la boîte de finition puis revenir est un geste NORMAL de la
 * rafale — mais l'état React de `BurstMode` meurt au démontage : la liste de
 * session disparaissait alors que tout est déjà en base, et l'utilisateur
 * croyait avoir tout perdu.
 *
 * `sessionStorage`, pas `localStorage` : la session meurt avec l'onglet —
 * c'est le bon cycle de vie (une étagère se range dans la soirée, pas dans la
 * semaine). Chaque lecture est défensive : un contenu inattendu rend `null`,
 * jamais une erreur.
 */

const BURST_SESSION_STORAGE_KEY = "burst-session-v1";

export type BurstSessionSnapshot = {
  intent: ScanIntent;
  dateKnown: boolean;
  date: string;
  items: BurstItem[];
  nextKey: number;
};

export function saveBurstSession(snapshot: BurstSessionSnapshot): void {
  try {
    sessionStorage.setItem(BURST_SESSION_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Stockage plein ou indisponible : la persistance est un confort, jamais
    // une condition — la rafale continue sans elle.
  }
}

export function loadBurstSession(): BurstSessionSnapshot | null {
  try {
    const raw = sessionStorage.getItem(BURST_SESSION_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as BurstSessionSnapshot;
    if (!Array.isArray(parsed.items) || typeof parsed.nextKey !== "number") return null;
    return {
      ...parsed,
      // Une ligne « resolving » interrompue en plein vol ne tournera plus
      // jamais : sa continuation async est morte avec la page. Le serveur a
      // peut-être capté le scan (la boîte fait foi) — on la marque « À
      // compléter », jamais un spinner fantôme (#131).
      // `restored: true` sur chaque ligne : après un rechargement, ces
      // captures sont DÉJÀ dans le compteur de la boîte chargé au montage —
      // les recompter doublerait le total du bandeau (#130, vu en prod).
      items: parsed.items.map((item) => ({
        ...item,
        restored: true,
        ...(item.status === "resolving"
          ? { status: "error" as const, message: "Interrompu — vérifie la boîte de finition." }
          : {}),
      })),
    };
  } catch {
    return null;
  }
}

export function hasBurstSession(): boolean {
  try {
    return sessionStorage.getItem(BURST_SESSION_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/** « Terminer » : la session est close, le prochain mode rafale repart à vide. */
export function clearBurstSession(): void {
  try {
    sessionStorage.removeItem(BURST_SESSION_STORAGE_KEY);
  } catch {
    // Rien à faire : au pire la session se videra à la fermeture de l'onglet.
  }
}
