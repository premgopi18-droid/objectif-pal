import { isBooklandCode } from "@/lib/resolution/barcode-router";

/**
 * Faut-il attendre le supplément de 5 chiffres avant d'émettre ce code ?
 * (fluidité #331, item 1 — epic #330)
 *
 * Le supplément n'a pas le même sens selon le support (specs §5.1) :
 *  - fascicule VO (UPC-A) : numéro d'issue, couverture, tirage → il vaut de
 *    l'attendre, la fenêtre de grâce du scanner existe pour lui ;
 *  - livre (EAN-13 préfixé 978/979, un ISBN) : le PRIX → le routeur le jette
 *    (`classifyScannedCode` ne garde que l'EAN-13), le cache est indexé sur
 *    l'EAN-13 et la bibliothèque matche sur la colonne `isbn`. Attendre 1,5 s
 *    ici, c'était 1,5 s de perdues à CHAQUE scan de BD, manga ou roman.
 *
 * Pure et testée : la décision d'émission ne vit pas dans le composant caméra.
 */

/** À partir de cette longueur, le code lu porte déjà son supplément (13 + 5, ou 12 + 5 sous forme EAN-13). */
export const CODE_WITH_SUPPLEMENT_MIN_LENGTH = 14;

export function hasSupplement(digits: string): boolean {
  return digits.length >= CODE_WITH_SUPPLEMENT_MIN_LENGTH;
}

/** Vrai si le code est complet tel quel : il peut partir sans fenêtre de grâce. */
export function isReadyToEmit(digits: string): boolean {
  return hasSupplement(digits) || isBooklandCode(digits);
}
