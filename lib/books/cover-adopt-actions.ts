"use server";

import { isKnownCoverImageUrl } from "@/lib/books/cover-repair";
import { isSharedCoverUrl } from "@/lib/books/cover-photo";
import { getSessionOrError } from "@/lib/supabase/server";

/**
 * Adopte une couverture arrivée APRÈS l'enregistrement du livre (fluidité
 * #332, item 3) : au scan unitaire, l'identité est rendue avant l'image, et
 * l'utilisateur peut avoir tapé « je commence » avant qu'elle n'arrive — le
 * livre est alors créé sans `cover_url`. Quand la seconde phase répond, le
 * client pose l'image ici.
 *
 * Jamais par-dessus une couverture existante ni un choix (#275) : la mise à
 * jour ne porte que sur `cover_url IS NULL`. Et seulement une URL d'un hôte de
 * couverture connu ou du pool partagé — la même allowlist que la réparation.
 * Pas de `revalidatePath` : le client applique l'image localement.
 */
export type AdoptCoverResult = { ok: true } | { ok: false; error: string };

export async function adoptResolvedCover(bookId: string, coverUrl: string): Promise<AdoptCoverResult> {
  const session = await getSessionOrError();
  if (!session) return { ok: false, error: "Session expirée — reconnecte-toi." };
  if (!isKnownCoverImageUrl(coverUrl) && !isSharedCoverUrl(coverUrl)) {
    return { ok: false, error: "Cette image ne vient pas d'une source de couverture connue." };
  }
  const { error } = await session.supabase
    .from("books")
    .update({ cover_url: coverUrl })
    .eq("id", bookId)
    .eq("user_id", session.user.id)
    .is("cover_url", null);
  if (error) {
    console.error("[covers] adoptResolvedCover:", error.message);
    return { ok: false, error: "La couverture n'a pas pu être enregistrée." };
  }
  return { ok: true };
}
