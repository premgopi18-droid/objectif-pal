/**
 * Le verdict d'un run de rapatriement des couvertures (#272) — pur, testé,
 * partagé par scripts/covers-internalize.mjs.
 *
 * Avant : « 0 rapatriée + au moins un échec → exit 1 ». Ce garde-fou
 * confondait « panne réseau ou bucket » et « il ne reste que des cadavres
 * dans la file » : dès que le reliquat externe n'est fait que de liens morts
 * que personne n'affiche (donc jamais réparés par #53), le cron était rouge
 * TOUS les jours — #270 (29 fantômes Inventaire) n'en était qu'un cas.
 *
 * Trois familles d'échec, classées à la source :
 *  - corpse  : le tiers a RÉPONDU, mais pas une image exploitable (HTTP ≠ 2xx,
 *              content-type étranger, corps vide ou trop gros, fichier
 *              illisible). Normal — la réparation #53 les traite, on retente
 *              demain. Un CDN entier en 5xx est un cadavre du jour : demain.
 *  - network : aucune réponse HTTP (fetch qui jette, timeout). Un seul parmi
 *              des cadavres n'est rien ; TOUS les essais en réseau, c'est une
 *              panne.
 *  - infra   : NOTRE côté (bucket, base, erreur inattendue). Toujours rouge.
 */

/** Une erreur de rapatriement qui connaît sa famille. */
export class CoverFailure extends Error {
  /** @param {"corpse" | "network" | "infra"} kind */
  constructor(kind, message) {
    super(message);
    this.name = "CoverFailure";
    this.kind = kind;
  }
}

/**
 * La famille d'une erreur attrapée dans la boucle : une CoverFailure porte la
 * sienne, tout le reste est de l'infra — l'inattendu est rouge, jamais
 * rangé en silence chez les cadavres.
 * @returns {"corpse" | "network" | "infra"}
 */
export function classifyFailure(error) {
  return error instanceof CoverFailure ? error.kind : "infra";
}

/**
 * Rouge seulement sur panne d'INFRA, ou sur panne RÉSEAU totale : rien de
 * rapatrié, aucune réponse HTTP reçue, et au moins un essai. Les cadavres
 * seuls (ou mêlés à quelques erreurs réseau) laissent le run vert.
 * @param {{ internalized: number; corpse: number; network: number; infra: number }} counts
 */
export function shouldFailRun({ internalized, corpse, network, infra }) {
  if (infra > 0) return true;
  return internalized === 0 && network > 0 && corpse === 0;
}
