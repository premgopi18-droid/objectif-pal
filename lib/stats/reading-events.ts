import { fetchAllRows } from "@/lib/supabase/pagination";
import type { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import type { Month } from "@/lib/scoring/types";

/**
 * Lecture du journal d'états `reading_events` (specs §4.2, §7) — jusqu'ici écrit
 * par le trigger `append_reading_event` mais JAMAIS lu. C'est le prérequis du
 * lot A de #30 (abandons & reprises), livré ici sans encore le consommer :
 * l'extension du moteur de stats (étape 2) appellera `summarizeReadingEvents`.
 *
 * Deux morceaux séparés, comme le reste du dossier :
 *   - `fetchReadingEventFacts` : la requête (impure, filtrée user_id + RLS) ;
 *   - `summarizeReadingEvents` : l'agrégation PURE et testable.
 */

type ReadingEventRow = Database["public"]["Tables"]["reading_events"]["Row"];

/**
 * Le sous-ensemble du Row dont l'agrégation a besoin — dérivé des types générés :
 * une colonne renommée casse le build, pas la prod. `occurredAt` est un
 * timestamptz ISO (`2026-07-13T00:00:00+00:00`), `id` l'identité monotone.
 */
export type ReadingEventFact = {
  id: ReadingEventRow["id"];
  readingId: ReadingEventRow["reading_id"];
  status: ReadingEventRow["status"];
  occurredAt: ReadingEventRow["occurred_at"];
};

export type ReadingEventsSummary = {
  /** Nombre d'abandons par mois (`YYYY-MM`) — mois sans abandon absents. */
  abandonsByMonth: Record<Month, number>;
  /**
   * Nombre de reprises par mois (`YYYY-MM`) — un événement `reading` qui n'est
   * PAS le premier de sa lecture (reprise d'un abandon ou réouverture d'une
   * lecture terminée). Le tout premier `reading` est un début, jamais compté.
   */
  resumptionsByMonth: Record<Month, number>;
};

/** `2026-07-13T00:00:00+00:00` → `2026-07`. Le mois calendaire (UTC) de l'événement. */
const monthOf = (occurredAt: string): Month => occurredAt.slice(0, 7);

const increment = (counts: Record<Month, number>, month: Month): void => {
  counts[month] = (counts[month] ?? 0) + 1;
};

/**
 * Agrège le journal d'états en comptages mensuels d'abandons et de reprises.
 *
 * Le classement « début vs reprise » suit l'ordre d'INSERTION (`id`, monotone),
 * l'ordre RÉEL des transitions — et non `occurred_at`, qui est la date sémantique
 * (rétro-datable) servant seulement à ranger un événement dans son mois. Pur :
 * aucune horloge, aucune requête.
 */
export function summarizeReadingEvents(events: ReadingEventFact[]): ReadingEventsSummary {
  const abandonsByMonth: Record<Month, number> = {};
  const resumptionsByMonth: Record<Month, number> = {};

  // Une lecture est « déjà vue » dès son premier événement : les `reading`
  // suivants sont des reprises. Copie avant tri (ne pas muter l'entrée).
  const ordered = [...events].sort((left, right) => left.id - right.id);
  const startedReadings = new Set<ReadingEventFact["readingId"]>();

  for (const event of ordered) {
    const isFirstEvent = !startedReadings.has(event.readingId);
    startedReadings.add(event.readingId);

    // Un événement sans date (#101 : « déjà lu » sans date de fin) ne peut être
    // rangé dans aucun mois. Il reste au journal — rien n'est jamais effacé
    // (§7) — mais ne compte nulle part plutôt que de fausser un mois.
    if (event.occurredAt === null) continue;

    if (event.status === "abandoned") {
      increment(abandonsByMonth, monthOf(event.occurredAt));
    } else if (event.status === "reading" && !isFirstEvent) {
      increment(resumptionsByMonth, monthOf(event.occurredAt));
    }
  }

  return { abandonsByMonth, resumptionsByMonth };
}

/**
 * Charge les événements de l'utilisateur, triés par ordre d'insertion. La RLS
 * (`reading_events_select_own`) filtre déjà sur `user_id` ; l'`eq` explicite
 * cible l'index posé en #27 et documente le prédicat. Retourne `null` en cas
 * d'erreur (le consommateur affiche un état d'échec, comme ailleurs).
 */
export async function fetchReadingEventFacts(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
): Promise<ReadingEventFact[] | null> {
  try {
    // Paginé (#178) : la table append-only produit 2-3 lignes par lecture —
    // la PREMIÈRE de l'app à franchir le plafond PostgREST de 1 000 lignes,
    // qui tronque SANS erreur. Des événements manquants = un rythme (abandons,
    // reprises) silencieusement faux au bilan. L'id (monotone) trie ET pagine.
    const rows = await fetchAllRows(async (from, to) => {
      const { data, error } = await supabase
        .from("reading_events")
        .select("id, reading_id, status, occurred_at")
        .eq("user_id", userId)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) throw new Error(error.message);
      return data ?? [];
    });

    return rows.map((row) => ({
      id: row.id,
      readingId: row.reading_id,
      status: row.status,
      occurredAt: row.occurred_at,
    }));
  } catch (error) {
    console.error("[stats] fetchReadingEventFacts:", error instanceof Error ? error.message : String(error));
    return null;
  }
}
