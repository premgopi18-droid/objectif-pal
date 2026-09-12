import type { ReactNode } from "react";
import { BookCover } from "@/components/book-cover";

/**
 * La ligne de livre (design-specs §4) : vignette + titre + méta + zone d'action.
 * LA ligne partagée Journal/Biblio. La vignette **compose** le `BookCover`
 * existant (chaîne de replis couvertures §5.4 intacte) — elle ne le réécrit pas ;
 * on lui passe le titre pour son placeholder « dégradé + initiale ».
 * Purement présentatiel.
 */

type BookRowProps = {
  title: string;
  meta?: ReactNode;
  coverUrl?: string | null;
  /** Le livre en base — permet la réparation de couverture (cf. BookCover). */
  bookId?: string | null;
  /** L'emoji de secours si pas de couverture ET pas de placeholder par titre. */
  placeholderEmoji?: string;
  /** La zone d'action à droite (badge, bouton…). */
  action?: ReactNode;
  /** La zone AVANT la vignette (la case du mode sélection #256). */
  leading?: ReactNode;
  /**
   * La vignette devient un bouton (#275) : le tap ouvre « Changer la
   * couverture ». Absent, la vignette reste inerte (Journal, listes de scan).
   */
  onCoverPress?: () => void;
};

export function BookRow({
  title,
  meta,
  coverUrl = null,
  bookId = null,
  placeholderEmoji,
  action,
  leading,
  onCoverPress,
}: BookRowProps) {
  const cover = (
    <BookCover coverUrl={coverUrl} size="small" title={title} bookId={bookId} placeholderEmoji={placeholderEmoji} />
  );
  return (
    <article className="flex items-center gap-3 rounded-card border border-line bg-card p-3">
      {leading}
      {onCoverPress ? (
        <button
          type="button"
          onClick={onCoverPress}
          aria-label={`Changer la couverture de ${title}`}
          className="flex-none rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
        >
          {cover}
        </button>
      ) : (
        cover
      )}
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-[15px] font-semibold text-ink">{title}</h3>
        {meta != null && <div className="mt-0.5 text-[12.5px] text-ink2">{meta}</div>}
      </div>
      {action != null && <div className="flex flex-none flex-col items-end gap-1.5">{action}</div>}
    </article>
  );
}
