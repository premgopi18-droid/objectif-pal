import Image from "next/image";

/**
 * La vignette de couverture — l'image distante, ou un emoji de secours.
 * Deux tailles : `small` pour les listes (journal, PAL), `large` pour la
 * feuille de scan. Les images passent par l'optimiseur next/image (les hôtes
 * Metron et Google Books sont dans `remotePatterns`) : `sizes` fixe la
 * largeur affichée pour ne servir que la variante utile en mobile.
 */

const COVER_SIZES = {
  small: {
    width: 48,
    height: 72,
    sizes: "48px",
    imageClassName: "h-18 w-12 shrink-0 rounded object-cover",
    placeholderClassName: "flex h-18 w-12 shrink-0 items-center justify-center rounded bg-foreground/10",
  },
  large: {
    width: 96,
    height: 144,
    sizes: "96px",
    imageClassName: "h-36 w-24 shrink-0 rounded-md object-cover",
    placeholderClassName: "flex h-36 w-24 shrink-0 items-center justify-center rounded-md bg-foreground/10 text-3xl",
  },
} as const;

type BookCoverProps = {
  coverUrl: string | null;
  size: keyof typeof COVER_SIZES;
  /** L'emoji affiché quand il n'y a pas de couverture. */
  placeholderEmoji?: string;
};

export function BookCover({ coverUrl, size, placeholderEmoji = "📚" }: BookCoverProps) {
  const variant = COVER_SIZES[size];

  if (coverUrl) {
    return (
      <Image src={coverUrl} alt="" width={variant.width} height={variant.height} sizes={variant.sizes} className={variant.imageClassName} />
    );
  }

  return (
    <div aria-hidden className={variant.placeholderClassName}>
      {placeholderEmoji}
    </div>
  );
}
