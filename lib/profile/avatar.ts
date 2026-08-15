/**
 * La photo de profil (issue #224) — les constantes partagées client/serveur,
 * sur le modèle de lib/books/cover-photo.ts.
 *
 * Bucket SÉPARÉ de `covers` : la purge mensuelle des orphelins ratisse covers
 * et supprimerait un avatar non référencé par un livre. Un seul objet par
 * utilisateur, écrasé à chaque changement — jamais d'accumulation.
 */

export const AVATARS_BUCKET = "avatars";

export const AVATAR_PHOTO = {
  /** Le grand côté maximal, en pixels — un avatar s'affiche petit et rond. */
  maxDimension: 256,
  /** La qualité WebP (0-1) — ~10-15 Ko par avatar. */
  webpQuality: 0.85,
} as const;

/** LE chemin de l'avatar d'un utilisateur (un seul, écrasé si changé). */
export const avatarPath = (userId: string) => `${userId}/avatar.webp`;
