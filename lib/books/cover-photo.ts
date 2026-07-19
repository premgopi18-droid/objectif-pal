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
 * Redimensionne et convertit la photo en WebP via canvas — jamais l'image
 * brute du capteur (souvent plusieurs Mo) sur le réseau.
 */
export async function fileToWebpBlob(file: File): Promise<Blob> {
  // `from-image` : l'orientation EXIF du capteur est appliquée — sans ça,
  // une photo prise en portrait peut atterrir couchée selon le navigateur.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, COVER_PHOTO.maxDimension / Math.max(bitmap.width, bitmap.height));
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
      COVER_PHOTO.webpQuality,
    );
  });
}
