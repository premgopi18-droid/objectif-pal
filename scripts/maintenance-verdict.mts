/**
 * La décision « orphelin ou pas » de la purge mensuelle (#205), PURE et
 * testée — le script `maintenance-purge.mts` ne fait que l'appliquer.
 *
 * Un objet du bucket est orphelin s'il n'est référencé par aucune ligne
 * (books.cover_url même soft-supprimé, scan_inbox en attente, et depuis #278
 * cover_contributions vivantes — la copie partagée survit à son auteur tant
 * qu'un livre ou une contribution la référence) ET s'il a passé la marge de
 * sécurité (une rafale en cours n'a pas fini son chemin).
 */
export function isOrphan({
  path,
  createdAt,
  referenced,
  cutoffMs,
}: {
  path: string;
  createdAt: string | null | undefined;
  referenced: Set<string>;
  cutoffMs: number;
}): boolean {
  const createdAtMs = Date.parse(createdAt ?? "");
  // Marge de sécurité : trop récent = on ne touche pas. Une date illisible ne
  // protège pas (l'objet aurait toujours été « récent »).
  if (Number.isFinite(createdAtMs) && createdAtMs > cutoffMs) return false;
  return !referenced.has(path);
}
