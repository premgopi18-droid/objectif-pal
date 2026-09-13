import { Button } from "@/components/ui/button";
import type { MergeCandidatePair } from "@/lib/series/merge-candidates";

/**
 * La bannière de fusion (lot B, §4.17-9) : « Berserk » et « Berserk (Glénat) »
 * n'en font qu'une ? Fusionner = la RPC `merge_series` (pour tous les comptes) ;
 * « Ce sont deux séries » = la paire est mémorisée localement, jamais en base.
 * Une seule bannière à la fois — le parent choisit la première paire.
 */
export function MergeBanner({
  pair,
  isPending,
  onMerge,
  onDismiss,
}: {
  pair: MergeCandidatePair;
  isPending: boolean;
  onMerge: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="region"
      aria-label="Deux graphies d'une même série ?"
      className="flex flex-col gap-3 rounded-card border border-cyan/30 bg-cyan/10 p-3 text-sm text-ink"
    >
      <p>
        📚 <b className="font-semibold">« {pair.keep.name} »</b> et <b className="font-semibold">« {pair.merge.name} »</b> n&apos;en
        font qu&apos;une ?
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="grad" disabled={isPending} onClick={onMerge}>
          Fusionner
        </Button>
        <Button type="button" variant="ghost" disabled={isPending} onClick={onDismiss}>
          Ce sont deux séries
        </Button>
      </div>
    </div>
  );
}
