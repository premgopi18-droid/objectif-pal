/**
 * Le tri des listes (issue #217) — un vocabulaire d'options commun aux trois
 * pages (PAL, Biblio, Journal) et UN comparateur pur, paramétré par des
 * accesseurs : chaque liste branche ses propres champs, la sémantique du tri
 * ne vit qu'ici.
 *
 * Décisions du 15/08/2026 :
 *  - « ajout » = `created_at` de la FICHE (le moment du scan) — jamais une
 *    date métier nullable qui enverrait le dernier scan en bas de liste ;
 *  - alphabétique tel qu'écrit (article compté, `localeCompare` fr) — le
 *    classement « à la bibliothécaire » (articles ignorés) reste une évolution
 *    possible, notée dans le ticket ;
 *  - les égalités se départagent par titre puis stabilité d'entrée : deux
 *    livres d'une même rafale (created_at quasi identiques) sortent en ordre
 *    lisible, pas en ordre d'insertion SQL.
 */

export type EntrySortOption = "ajout" | "ajout-ancien" | "activite" | "titre" | "titre-inverse";

/** Les libellés du sélecteur — partagés pour que les trois pages parlent pareil. */
export const ENTRY_SORT_LABELS: Record<EntrySortOption, string> = {
  ajout: "Ajout récent",
  "ajout-ancien": "Ajout ancien",
  activite: "Activité récente",
  titre: "A → Z",
  "titre-inverse": "Z → A",
};

const byTitle = (left: string, right: string) => left.localeCompare(right, "fr");

export function sortEntriesBy<T>(
  entries: T[],
  option: EntrySortOption,
  get: {
    createdAt: (entry: T) => string;
    title: (entry: T) => string;
    /** La dernière activité (#146 Biblio) — absente, « activite » retombe sur l'ajout. */
    activityAt?: (entry: T) => string;
  },
): T[] {
  const sorted = [...entries];
  const dateOf = option === "activite" && get.activityAt ? get.activityAt : get.createdAt;
  sorted.sort((left, right) => {
    switch (option) {
      case "titre":
        return byTitle(get.title(left), get.title(right));
      case "titre-inverse":
        return byTitle(get.title(right), get.title(left));
      case "ajout-ancien":
        return dateOf(left).localeCompare(dateOf(right)) || byTitle(get.title(left), get.title(right));
      default: // « ajout » et « activite » : la plus récente d'abord
        return dateOf(right).localeCompare(dateOf(left)) || byTitle(get.title(left), get.title(right));
    }
  });
  return sorted;
}
