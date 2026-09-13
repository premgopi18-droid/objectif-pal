import Link from "next/link";
import { BookCover } from "@/components/book-cover";
import { Card } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import type { SeriesSummary } from "@/lib/series/derive-series";

/**
 * « Mes séries » dans les Stats (lot C de l'epic #289, maquette cadran B) —
 * la moisson du suivi de séries sans rien demander de plus : quatre tuiles,
 * la dette de série (possédés pas lus), et « à lire ensuite ». Chaque ligne
 * ouvre la fiche série de la Biblio. Remplace la section « Séries en cours »
 * adossée au catalogue GCD (§4.5, retirée par §4.17-5).
 *
 * Purement présentatiel : l'agrégat vient de `summarizeSeries` (pur, testé).
 */
export function SeriesSummarySection({ summary, seriesCount }: { summary: SeriesSummary; seriesCount: number }) {
  const maxDebt = Math.max(1, ...summary.topDebt.map((entry) => entry.pile));

  if (seriesCount === 0) {
    return (
      <Card className="text-sm text-ink2">
        Pas encore de série suivie — une série apparaît à partir de deux tomes, dans l&apos;onglet Séries de la
        Bibliothèque.
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="En cours" value={summary.inProgress} />
        <StatTile label="À jour" value={summary.upToDate} tone="good" />
        <StatTile label="Complètes" value={summary.complete} tone="good" />
        <StatTile label="Tomes en dette" value={summary.debt} tone={summary.debt > 0 ? "amber" : "default"} />
      </div>

      {summary.topDebt.length > 0 && (
        <Card>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink3">
            Dette de série <span className="font-semibold normal-case tracking-normal">— possédés pas lus</span>
          </h3>
          <ul className="mt-2.5 flex flex-col gap-2" aria-label="Les plus grosses dettes de série">
            {summary.topDebt.map((entry) => (
              <li key={entry.seriesId} className="flex items-center gap-3 text-sm">
                <Link
                  href={`/bibliotheque?vue=series&serie=${entry.seriesId}`}
                  className="min-w-0 flex-1 truncate font-semibold text-ink underline-offset-2 hover:underline"
                >
                  {entry.name}
                </Link>
                <span aria-hidden className="h-1.5 w-24 overflow-hidden rounded-full bg-card2">
                  <span className="block h-full rounded-full bg-amber" style={{ width: `${(entry.pile / maxDebt) * 100}%` }} />
                </span>
                <span className="w-16 shrink-0 text-right text-xs tabular-nums text-ink2">
                  {entry.pile} tome{entry.pile > 1 ? "s" : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {summary.nextToRead.length > 0 && (
        <Card>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink3">À lire ensuite</h3>
          <ul className="mt-2.5 flex flex-col gap-2.5" aria-label="Les tomes suivants">
            {summary.nextToRead.map((entry) => {
              const inPile = entry.next.kind === "read-next";
              const hint = inPile
                ? entry.totalVolumes !== null
                  ? `tu en es au tome ${entry.read} sur ${entry.totalVolumes}`
                  : `le tome ${entry.next.number} est déjà dans ta pile`
                : `il te manque le tome ${entry.next.number}`;
              return (
                <li key={entry.seriesId}>
                  <Link
                    href={`/bibliotheque?vue=series&serie=${entry.seriesId}`}
                    className="flex items-center gap-3 rounded-xl text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
                  >
                    <BookCover coverUrl={entry.coverUrl} size="small" title={entry.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink">{entry.name}</span>
                      <span className="block text-xs text-ink3">{hint}</span>
                    </span>
                    <span className={`shrink-0 text-sm font-bold tabular-nums ${inPile ? "text-cyan" : "text-amber"}`}>
                      t.{entry.next.number} {inPile ? "→" : "🛒"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
