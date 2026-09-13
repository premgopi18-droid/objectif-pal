import { BookCover } from "@/components/book-cover";
import { Badge } from "@/components/ui/badge";
import { CATEGORY_LABELS } from "@/lib/books/categories";
import { SERIES_STATUS_LABELS, seriesCountsText } from "@/lib/series/copy";
import type { SeriesProgress } from "@/lib/series/derive-series";

/**
 * La carte d'une série dans le segment (lot B, maquette cadran A) : pile de
 * vignettes, nom, catégorie · tomes, badge d'état, jauge **vert = lu · ambre
 * = dans la pile · piste = le reste**, ligne de compteurs. Tout le contenu est
 * dérivé en amont ; ici on pose. Le tap ouvre la fiche.
 */

/** La jauge : sa base est le total déclaré, sinon le plus grand numéro possédé (ou le compte). */
export function gaugeWidths(progress: Pick<SeriesProgress, "read" | "pile" | "totalVolumes" | "gridMax">): {
  read: number;
  pile: number;
} {
  const base = progress.totalVolumes ?? Math.max(progress.gridMax, progress.read + progress.pile, 1);
  return { read: Math.min(100, (progress.read / base) * 100), pile: Math.min(100, (progress.pile / base) * 100) };
}

export function SeriesGauge({ progress }: { progress: SeriesProgress }) {
  const widths = gaugeWidths(progress);
  return (
    // Un <span> : la jauge vit aussi dans le bouton de la carte (contenu phrasé, review #296).
    <span
      role="img"
      aria-label={`${progress.read} lus, ${progress.pile} dans la pile${progress.totalVolumes !== null ? ` sur ${progress.totalVolumes}` : ""}`}
      className="flex h-2 w-full overflow-hidden rounded-full bg-card2"
    >
      <span className="block h-full bg-green transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${widths.read}%` }} />
      <span className="block h-full bg-amber transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${widths.pile}%` }} />
      {progress.isOngoing && <span aria-hidden className="block h-full flex-1 bg-gradient-to-r from-card2 to-transparent" />}
    </span>
  );
}

export function SeriesCard({ progress, onOpen }: { progress: SeriesProgress; onOpen: () => void }) {
  const status = SERIES_STATUS_LABELS[progress.status];
  const covers = progress.volumes.filter((volume) => volume.state !== "other").slice(0, 3);
  const tomes = progress.read + progress.pile;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${progress.name} — ${status.label}, ${seriesCountsText(progress)}`}
      className="flex w-full flex-col gap-2.5 rounded-card border border-line bg-card p-3 text-left transition active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
    >
      <span className="flex items-center gap-3">
        <span aria-hidden className="flex flex-none -space-x-8">
          {covers.map((volume, index) => (
            <span key={volume.bookId} className="block rounded shadow-float" style={{ zIndex: covers.length - index }}>
              <BookCover coverUrl={volume.coverUrl} size="small" title={volume.title} bookId={volume.bookId} />
            </span>
          ))}
        </span>
        {/* Des <span> en bloc, pas de <h3>/<p> : un bouton n'accepte que du
            contenu phrasé (review #296) — l'aria-label porte l'annonce. */}
        <span className="block min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-ink">{progress.name}</span>
          <span className="mt-0.5 block text-[12.5px] text-ink2">
            {CATEGORY_LABELS[progress.category]} · {tomes} tome{tomes > 1 ? "s" : ""}
          </span>
        </span>
        <Badge state={status.badge}>{status.label}</Badge>
        <span aria-hidden className="text-ink3">›</span>
      </span>
      <SeriesGauge progress={progress} />
      <span className="block text-xs text-ink2">{seriesCountsText(progress)}</span>
    </button>
  );
}
