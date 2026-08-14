/**
 * L'anti-troncature PostgREST (issue #178, epic #182).
 *
 * PostgREST plafonne toute réponse à `max_rows = 1000` (config.toml) et
 * tronque SANS ERREUR : une requête de liste sans `.range()` rend
 * silencieusement les 1 000 premières lignes. En solo on est loin du seuil ;
 * à l'ouverture, `reading_events` (2-3 lignes par lecture) le franchit en
 * premier — et un export « toutes mes données » amputé sans le dire trahit la
 * promesse du §4.10.
 *
 * `fetchAllRows` boucle par pages de `POSTGREST_MAX_ROWS` jusqu'à une page
 * incomplète — le seul signal fiable de fin (le patron de fetchSeriesCatalog).
 *
 * Limite assumée : c'est une pagination par OFFSET — des écritures concurrentes
 * peuvent décaler une ligne d'une page à l'autre. Les consommateurs (export,
 * stats) lisent des données de l'utilisateur courant, triées sur des clés
 * stables, pendant qu'il regarde son écran : le risque réel est nul, et un
 * doublon vaut toujours mieux qu'une amputation silencieuse.
 */

/** En phase avec `max_rows` (supabase/config.toml) — jamais recopié ailleurs. */
export const POSTGREST_MAX_ROWS = 1000;

export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const from = rows.length;
    const page = await fetchPage(from, from + POSTGREST_MAX_ROWS - 1);
    rows.push(...page);
    if (page.length < POSTGREST_MAX_ROWS) return rows;
  }
}
