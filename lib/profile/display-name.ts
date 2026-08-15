/**
 * La normalisation du pseudo (issue #224) — logique PURE, testée : le pseudo
 * est destiné à être MONTRÉ (page Profil aujourd'hui, cercle d'amis §4.14
 * demain), il doit rester propre quel que soit ce qui est tapé.
 */

/** Les bornes du pseudo — assez pour « Jean-Michel Dupont-Lajoie », pas pour un roman. */
export const DISPLAY_NAME_MAX_LENGTH = 40;

export type DisplayNameResult = { ok: true; value: string } | { ok: false; error: string };

/**
 * Trim + espaces internes réduits à un seul (un copier-coller enthousiaste ne
 * fabrique pas « Léna     du   plateau »), puis bornes. Vide = refusé : un
 * pseudo blanc rendrait le profil et le futur cercle illisibles.
 */
export function normalizeDisplayName(raw: string): DisplayNameResult {
  const value = raw.trim().replace(/\s+/g, " ");
  if (value.length === 0) return { ok: false, error: "Le pseudo ne peut pas être vide." };
  if (value.length > DISPLAY_NAME_MAX_LENGTH) {
    return { ok: false, error: `Le pseudo est limité à ${DISPLAY_NAME_MAX_LENGTH} caractères.` };
  }
  return { ok: true, value };
}
