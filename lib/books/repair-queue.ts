/**
 * Une file de concurrence minimale (#177) — au plus `maxConcurrent` tâches en
 * vol, les suivantes attendent leur tour (FIFO). Utilisée par la réparation
 * de couvertures : une bibliothèque dont l'hôte d'images est tombé ne
 * déclenche plus une salve de server actions simultanées — les vignettes
 * s'égrènent, et le quota serveur (5/min) fait le reste.
 *
 * Pure et sans dépendance : l'état vit dans la fermeture, un module client
 * peut en partager une instance entre toutes ses vignettes.
 */
export function createTaskQueue(maxConcurrent: number) {
  let active = 0;
  const waiting: (() => void)[] = [];

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrent) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
