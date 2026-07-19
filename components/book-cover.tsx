"use client";

import Image from "next/image";
import { useState } from "react";
import { repairBrokenCover } from "@/lib/books/cover-repair-actions";

/**
 * La vignette de couverture — l'image distante, ou un emoji de secours.
 * Deux tailles : `small` pour les listes (journal, PAL), `large` pour la
 * feuille de scan. Les images passent par l'optimiseur next/image (les hôtes
 * de la cascade sont dans `remotePatterns`) : `sizes` fixe la largeur
 * affichée pour ne servir que la variante utile en mobile.
 *
 * Une image qui ne charge plus déclenche la RÉPARATION (issue #53) quand le
 * livre est connu (`bookId`) : le serveur re-déroule la chaîne couverture et
 * répare `books.cover_url` — la vignette se remplace sur place. En attendant
 * (ou si rien ne remplace), l'emoji de secours prend la place : jamais
 * d'image cassée à l'écran.
 */

/**
 * Les réparations déjà tentées CETTE session — une URL morte ne déclenche
 * qu'UN aller-retour serveur, pas un à chaque affichage (l'anti-boucle de
 * l'issue #53). Mémoire de module : partagée entre toutes les vignettes,
 * réinitialisée au rechargement de la page.
 */
const attemptedRepairs = new Set<string>();

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
  /** Le livre en base — sans lui (feuille de scan, saisie), pas de réparation possible. */
  bookId?: string | null;
};

export function BookCover({ coverUrl, size, placeholderEmoji = "📚", bookId = null }: BookCoverProps) {
  // La réparation locale de CETTE vignette : l'URL en échec → sa remplaçante
  // (null = emoji de secours). Rattachée à l'URL des props : si le parent
  // re-rend avec une autre couverture, l'état ne s'applique plus.
  const [repair, setRepair] = useState<{ failedUrl: string; replacementUrl: string | null } | null>(null);

  const variant = COVER_SIZES[size];
  const effectiveUrl = repair && repair.failedUrl === coverUrl ? repair.replacementUrl : coverUrl;

  async function handleImageError() {
    if (!coverUrl) return;
    // L'emoji prend la place tout de suite : jamais d'image cassée visible.
    setRepair({ failedUrl: coverUrl, replacementUrl: null });
    const repairKey = `${bookId ?? ""}|${coverUrl}`;
    if (!bookId || attemptedRepairs.has(repairKey)) return;
    attemptedRepairs.add(repairKey);
    try {
      const result = await repairBrokenCover(bookId);
      if (result.coverUrl && result.coverUrl !== coverUrl) {
        setRepair({ failedUrl: coverUrl, replacementUrl: result.coverUrl });
      }
    } catch {
      // Serveur injoignable : l'emoji reste pour cette session, rien n'est écrit.
    }
  }

  if (effectiveUrl) {
    return (
      <Image
        src={effectiveUrl}
        alt=""
        width={variant.width}
        height={variant.height}
        sizes={variant.sizes}
        className={variant.imageClassName}
        onError={handleImageError}
      />
    );
  }

  return (
    <div aria-hidden className={variant.placeholderClassName}>
      {placeholderEmoji}
    </div>
  );
}
