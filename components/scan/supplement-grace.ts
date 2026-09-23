import { EAN13_LENGTH, isBooklandCode } from "@/lib/resolution/barcode-router";

/**
 * La décision d'émission du scanner, pure et testée (fluidité #331, item 1 —
 * epic #330) : le composant caméra ne fait que l'exécuter.
 *
 * Le supplément de 5 chiffres n'a pas le même sens selon le support (specs
 * §5.1) :
 *  - fascicule VO (UPC-A) : numéro d'issue, couverture, tirage → il vaut de
 *    l'attendre, la fenêtre de grâce du scanner existe pour lui ;
 *  - livre (EAN-13 préfixé 978/979, un ISBN) : le PRIX → le routeur le jette
 *    (`classifyScannedCode` ne garde que l'EAN-13), le cache est indexé sur
 *    l'EAN-13 et la bibliothèque matche sur la colonne `isbn`. Attendre 1,5 s
 *    ici, c'était 1,5 s de perdues à CHAQUE scan de BD, manga ou roman.
 */

/**
 * Plus long qu'un EAN-13 : un supplément, même partiel, a été lu — le seuil
 * historique du scanner (« il y a quelque chose après les 13 chiffres »).
 */
export const CODE_WITH_SUPPLEMENT_MIN_LENGTH = EAN13_LENGTH + 1;

export function hasSupplement(digits: string): boolean {
  return digits.length >= CODE_WITH_SUPPLEMENT_MIN_LENGTH;
}

/**
 * Vrai si le code est complet tel quel : il peut partir sans fenêtre de grâce.
 * La condition ISBN est EXACTEMENT celle du routeur (préfixe Bookland ET 13
 * chiffres) : un EAN-8 en 978… n'est pas un ISBN pour lui, pas pour nous non plus.
 */
export function isReadyToEmit(digits: string): boolean {
  return hasSupplement(digits) || (isBooklandCode(digits) && digits.length >= EAN13_LENGTH);
}

export type EmissionDecision =
  /** Émettre ce code (le code lu, ou celui en attente — cf. `decideEmission`). */
  | { kind: "emit"; code: string }
  /** Ouvrir la fenêtre de grâce sur ce code, en espérant son supplément. */
  | { kind: "wait"; code: string }
  /** Une grâce est ouverte : elle suit désormais ce code (scan unitaire). */
  | { kind: "track"; code: string };

/**
 * Que faire d'un code fraîchement décodé, sachant le code éventuellement en
 * grâce (`pendingCode`) et le mode (rafale ou unitaire) ?
 *
 * Rafale (#249) : un code DIFFÉRENT de celui en grâce, c'est que le livre
 * précédent est déjà rangé — son supplément ne viendra jamais. Il part TOUT DE
 * SUITE, que le nouveau code soit prêt ou non (review #334 : le raccourci ISBN
 * passait devant cette règle et perdait le fascicule en silence). Le nouveau
 * code sera relu par les frames après le réarmement — la sourdine ne mute que
 * le code émis, pas lui.
 *
 * Scan unitaire : le dernier code vu gagne (l'utilisateur a pu changer de
 * bouquin avant de valider quoi que ce soit).
 */
export function decideEmission(digits: string, pendingCode: string | null, continuous: boolean): EmissionDecision {
  if (continuous && pendingCode !== null && pendingCode !== digits) {
    return { kind: "emit", code: pendingCode };
  }
  if (isReadyToEmit(digits)) return { kind: "emit", code: digits };
  if (pendingCode === null) return { kind: "wait", code: digits };
  return { kind: "track", code: digits };
}
