/**
 * La photo de couverture — le filet ULTIME des couvertures (specs §5.4,
 * issue #33) : proposée uniquement quand toute la cascade n'a rien trouvé,
 * jamais un remplacement. Conversion WebP côté client (on n'uploade pas les
 * plusieurs Mo du capteur), compression décidée le 19/07/2026.
 */

export const COVER_PHOTO = {
  /** Le grand côté maximal, en pixels. */
  maxDimension: 800,
  /** La qualité WebP (0-1) — ~60-150 Ko par couverture. */
  webpQuality: 0.8,
} as const;

/** Le bucket Storage — public, chemins `{user_id}/{book_id}.webp`. */
export const COVERS_BUCKET = "covers";

/** Le chemin de LA photo d'un livre (une seule, écrasée si reprise). */
export const coverPhotoPath = (userId: string, bookId: string) => `${userId}/${bookId}.webp`;

/**
 * Le chemin d'une photo prise en RAFALE, AVANT qu'un livre n'existe (#108).
 *
 * En rafale, un livre sans code-barres est capté dans la boîte de finition
 * (`scan_inbox`) : il n'y a pas encore de `book_id` pour nommer l'objet. On
 * l'indexe donc sur un identifiant propre à la photo, préfixé `inbox-` pour ne
 * jamais heurter le `{user_id}/{book_id}.webp` d'une couverture de livre. Le
 * dossier reste `{user_id}/` — la RLS d'écriture n'autorise que celui-là (#33).
 *
 * L'URL publique qui en résulte vit dans `scan_inbox.cover_url`, passe au livre
 * à la finalisation, et — vivant dans notre bucket — reste une photo MAISON,
 * donc reprenable ensuite (`isHouseCoverPhotoUrl`, #47).
 */
export const inboxCoverPhotoPath = (userId: string, photoId: string) => `${userId}/inbox-${photoId}.webp`;

/**
 * Vrai si la couverture est une PHOTO MAISON (elle vit dans notre bucket) —
 * la seule qu'on a le droit de reprendre (#47) : une couverture de source
 * (Metron, Google, OpenLibrary, Inventaire) reste intouchable.
 */
export function isHouseCoverPhotoUrl(
  coverUrl: string | null,
  supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
): boolean {
  if (coverUrl === null || !supabaseUrl) return false;
  return coverUrl.startsWith(`${supabaseUrl}/storage/v1/object/public/${COVERS_BUCKET}/`);
}

/**
 * Vrai si la photo maison vit dans le dossier de CET utilisateur (#180).
 *
 * Le bucket est public : toutes les URLs se lisent, mais une URL soumise au
 * serveur (cover_url d'inbox) ne doit désigner qu'un objet du dossier de
 * l'appelant — sinon un compte pourrait s'approprier la photo d'un autre en
 * la rejouant depuis un export. La RLS d'écriture cloisonne déjà l'upload ;
 * cette garde cloisonne la RÉFÉRENCE.
 */
export function isOwnHouseCoverPhotoUrl(
  coverUrl: string | null,
  userId: string,
  supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
): boolean {
  if (coverUrl === null || !supabaseUrl) return false;
  // Comparaison sur l'URL PARSÉE, jamais sur la chaîne brute (review #183) :
  // `new URL()` résout les segments `../` — sans ça, `covers/user-1/../user-2/x`
  // passerait un startsWith naïf puis résoudrait vers le dossier d'un autre.
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(coverUrl);
    base = new URL(supabaseUrl);
  } catch {
    return false;
  }
  return (
    parsed.origin === base.origin &&
    parsed.pathname.startsWith(`/storage/v1/object/public/${COVERS_BUCKET}/${userId}/`)
  );
}

/**
 * Redimensionne et convertit la photo en WebP via canvas — jamais l'image
 * brute du capteur (souvent plusieurs Mo) sur le réseau. Dimensions et qualité
 * en options depuis #224 (l'avatar recompresse plus petit) — défauts inchangés :
 * la couverture reste le cas historique.
 */
export async function fileToWebpBlob(
  file: File,
  { maxDimension, webpQuality }: { maxDimension: number; webpQuality: number } = COVER_PHOTO,
): Promise<Blob> {
  // `from-image` : l'orientation EXIF du capteur est appliquée — sans ça,
  // une photo prise en portrait peut atterrir couchée selon le navigateur.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas 2d indisponible");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("conversion WebP impossible"))),
      "image/webp",
      webpQuality,
    );
  });
}
