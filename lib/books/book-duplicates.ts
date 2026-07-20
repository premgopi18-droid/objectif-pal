import type { LibraryEntry } from "@/lib/library/derive-library";

/**
 * La fusion de doublons (issue #100) — la partie PURE : qui peut fusionner
 * avec qui, et lequel des deux garder. La transaction vit dans la fonction SQL
 * `merge_books` ; ici, on décide et on explique, sans toucher la base.
 *
 * Le cas réel n'est pas « deux scans du même code » — la contrainte d'unicité
 * `(user_id, barcode_raw)` l'empêche déjà (§7). C'est **deux saisies
 * manuelles** du même livre : sans code-barres, les NULL ne s'égalent pas,
 * rien ne les bloque à l'écriture.
 */

/** Pourquoi une paire ne peut pas fusionner — le message est montré tel quel. */
export type MergeRefusal = { canMerge: false; reason: string };
export type MergeVerdict = { canMerge: true } | MergeRefusal;

/**
 * Deux codes-barres DIFFÉRENTS = deux éditions réelles, pas un doublon de
 * saisie. On refuse plutôt que de deviner — et ça évite un piège : l'unicité
 * `(user_id, barcode_raw)` **couvre les lignes supprimées**, donc rescanner le
 * doublon fusionné le ressusciterait (résurrection #10) et déferait la fusion.
 *
 * La même règle est réappliquée en SQL : ceci est la première ligne, pas la
 * garde.
 */
export function canMergeBooks(keep: LibraryEntry, candidate: LibraryEntry): MergeVerdict {
  if (keep.bookId === candidate.bookId) {
    return { canMerge: false, reason: "Un livre ne se fusionne pas avec lui-même." };
  }
  if (keep.hasBarcode && candidate.hasBarcode) {
    return {
      canMerge: false,
      reason: "Ces deux livres ont chacun un code-barres : ce sont deux éditions, pas un doublon.",
    };
  }
  return { canMerge: true };
}

/**
 * Les candidats à la fusion avec `keep`, filtrés par une recherche textuelle.
 *
 * On ne propose QUE des paires fusionnables : lister des livres qu'on refusera
 * ensuite ferait cliquer pour rien. Le tri met les titres les plus proches en
 * tête — un doublon porte presque toujours le même titre à une variante près.
 */
export function findMergeCandidates(
  keep: LibraryEntry,
  entries: LibraryEntry[],
  searchText: string,
): LibraryEntry[] {
  const needle = normalize(searchText.trim());
  const candidates = entries.filter((entry) => canMergeBooks(keep, entry).canMerge);
  const matching =
    needle === ""
      ? candidates
      : candidates.filter(
          (entry) =>
            normalize(entry.title).includes(needle) ||
            (entry.seriesName !== null && normalize(entry.seriesName).includes(needle)),
        );

  const keepTitle = normalize(keep.title);
  return matching.sort((left, right) => {
    // Un titre identique au livre conservé est le doublon le plus probable.
    const leftExact = normalize(left.title) === keepTitle ? 0 : 1;
    const rightExact = normalize(right.title) === keepTitle ? 0 : 1;
    if (leftExact !== rightExact) return leftExact - rightExact;
    return left.title.localeCompare(right.title, "fr");
  });
}

/** Minuscules + accents aplatis, comme la recherche de la Biblio (#63). */
const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/**
 * Ce que la confirmation annonce avant de fusionner — les traces qui vont
 * changer de livre. La fusion est **réversible sur le principe** (rien n'est
 * effacé, §7) mais pas d'un tap : on dit donc ce qu'on fait.
 */
export function describeMergeConsequence(keep: LibraryEntry, candidate: LibraryEntry): string {
  const traces = [
    candidate.activeReadingCount > 0 ? `${candidate.activeReadingCount} lecture(s)` : null,
    candidate.activePurchaseCount > 0 ? `${candidate.activePurchaseCount} achat(s)` : null,
  ].filter(Boolean);

  const moved =
    traces.length > 0
      ? `Ses ${traces.join(" et ")} seront rattachés à « ${keep.title} ». `
      : "Il n'a aucune trace active à déplacer. ";
  const barcode =
    !keep.hasBarcode && candidate.hasBarcode
      ? "Son code-barres passera au livre conservé, qui redeviendra rescannable. "
      : "";

  return `Fusionner « ${candidate.title} » dans « ${keep.title} » ? ${moved}${barcode}Le doublon disparaîtra des vues, sans rien effacer.`;
}
