import type { Database } from "@/lib/supabase/database.types";
import type { BookCategory } from "@/lib/scoring/types";

/**
 * La boîte de finition — la partie PURE (#101 lot C). Les server actions
 * vivent dans `scan-inbox-actions.ts` ; ici, rien que des transformations
 * testables : un élément capté → le brouillon de saisie qui le finalisera.
 */

type Tables = Database["public"]["Tables"];
export type ScanIntent = Tables["scan_inbox"]["Row"]["intent"];

/** Un élément en attente, tel que la page de finition le charge. */
export type ScanInboxItem = Pick<
  Tables["scan_inbox"]["Row"],
  "id" | "barcode_raw" | "barcode_type" | "cover_url" | "resolved_metadata" | "intent" | "owned_since" | "finished_at" | "created_at"
>;

/** Ce que la finition pré-remplit — la forme du formulaire de saisie manuelle. */
export type ScanInboxDraft = {
  title: string;
  seriesName: string | null;
  issueNumber: string | null;
  authors: string | null;
  publisher: string | null;
  pageCount: number | null;
  coverUrl: string | null;
  category: BookCategory | null;
  barcodeRaw: string | null;
  barcodeType: "isbn" | "upc" | null;
  isbn: string | null;
};

const CATEGORIES: readonly BookCategory[] = ["issue", "manga", "bd", "comics", "omnibus", "roman"];

/** Une valeur jsonb → une string exploitable, ou `null`. Jamais `"undefined"`. */
const text = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

/** Une valeur jsonb → un entier positif, ou `null` (un 0 ou un texte ne vaut rien ici). */
const positiveInteger = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

/** Une valeur jsonb → une catégorie du barème, ou `null` si ce n'en est pas une. */
const category = (value: unknown): BookCategory | null =>
  typeof value === "string" && (CATEGORIES as readonly string[]).includes(value) ? (value as BookCategory) : null;

/**
 * Le brouillon de finition : ce que la cascade avait trouvé de partiel, remis
 * dans la forme du formulaire.
 *
 * `resolved_metadata` est du **jsonb non typé** — c'est un brouillon d'une
 * source qui n'a répondu qu'à moitié, pas un contrat. On lit donc chaque champ
 * défensivement : une forme inattendue doit donner un formulaire vide à
 * remplir, jamais une erreur ni un `"undefined"` affiché à l'écran.
 */
export function toScanInboxDraft(item: ScanInboxItem): ScanInboxDraft {
  const metadata: Record<string, unknown> =
    item.resolved_metadata !== null && typeof item.resolved_metadata === "object" && !Array.isArray(item.resolved_metadata)
      ? (item.resolved_metadata as Record<string, unknown>)
      : {};

  return {
    title: text(metadata.title) ?? "",
    seriesName: text(metadata.seriesName),
    issueNumber: text(metadata.issueNumber),
    authors: text(metadata.authors),
    publisher: text(metadata.publisher),
    pageCount: positiveInteger(metadata.pageCount),
    // La couverture de la ligne fait foi : c'est elle qu'on a montrée à
    // l'utilisateur au moment du scan (« image oui, infos non », ou sa photo).
    coverUrl: item.cover_url,
    category: category(metadata.suggestedCategory),
    barcodeRaw: item.barcode_raw,
    barcodeType: item.barcode_type === "isbn" || item.barcode_type === "upc" ? item.barcode_type : null,
    isbn: text(metadata.isbn) ?? (item.barcode_type === "isbn" ? item.barcode_raw : null),
  };
}

/** Ce que la carte d'un élément annonce — l'intention est déjà décidée, jamais redemandée. */
export const INTENT_LABELS: Record<ScanIntent, string> = {
  own: "À ajouter à ma bibliothèque",
  own_read: "À marquer comme déjà lu",
};

/**
 * De quoi l'élément a-t-il l'air identifiable ? Sert au tri d'affichage : les
 * éléments qui ont déjà un titre se finalisent en un tap, les autres demandent
 * une vraie saisie — on montre les rapides d'abord pour que la boîte se vide.
 */
export function sortByCompletionEffort(items: ScanInboxItem[]): ScanInboxItem[] {
  return [...items].sort((left, right) => {
    const leftHasTitle = toScanInboxDraft(left).title !== "";
    const rightHasTitle = toScanInboxDraft(right).title !== "";
    if (leftHasTitle !== rightHasTitle) return leftHasTitle ? -1 : 1;
    // À effort égal, le plus ancien d'abord : on finit ce qu'on a commencé.
    return left.created_at.localeCompare(right.created_at);
  });
}
