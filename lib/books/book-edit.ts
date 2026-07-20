import { ALL_CATEGORIES, type BookCategory } from "@/lib/scoring/types";

/**
 * L'édition de fiche (issue #100) — la partie PURE : ce qu'on accepte, ce
 * qu'on normalise, ce qu'on refuse. La server action ne fait qu'appeler ça
 * puis écrire, pour que la règle soit testable sans Supabase.
 *
 * **Pourquoi cette UI existe** : le rescan corrigeait déjà les métadonnées,
 * mais un livre **saisi à la main n'a pas de code-barres à rescanner** — sa
 * fiche était donc fausse pour toujours (§4.12). Et la **catégorie** doit être
 * corrigeable partout : c'est elle qui détermine les points (§3).
 *
 * **Ce qui n'est PAS éditable, et c'est volontaire** : `barcode_raw`,
 * `barcode_type`, `barcode_prefix`, `metadata_source`, `metadata_source_id`.
 * C'est le **pont de re-résolution** (§7) — ce qui permet de re-dériver tout
 * l'historique si on change de source demain. Une saisie humaine dessus le
 * casserait en silence.
 */

/** Ce que le formulaire envoie — les champs bruts, avant normalisation. */
export type BookEditInput = {
  title: string;
  seriesName: string;
  issueNumber: string;
  authors: string;
  publisher: string;
  /** Chaîne parce qu'elle vient d'un `<input type="number">` — « » = non renseigné. */
  pageCount: string;
  category: BookCategory;
};

/** Ce qui part en base — colonnes réelles, valeurs normalisées. */
export type BookEditPayload = {
  title: string;
  series_name: string | null;
  issue_number: string | null;
  authors: string | null;
  publisher: string | null;
  page_count: number | null;
  category: BookCategory;
};

export type BookEditResult = { ok: true; payload: BookEditPayload } | { ok: false; error: string };

/** Une chaîne de formulaire → une valeur de base : vide et espaces valent « pas de valeur ». */
const trimmedOrNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

/**
 * Valide et normalise une édition de fiche. Rend un message en français —
 * c'est lui que l'utilisateur lira, il ne doit jamais rester technique.
 */
export function prepareBookEdit(input: BookEditInput): BookEditResult {
  const title = input.title.trim();
  if (title === "") return { ok: false, error: "Le titre est obligatoire." };

  // La catégorie vient du client et **pèse sur le score** : on ne fait jamais
  // confiance à la valeur reçue, même envoyée par notre propre formulaire.
  if (!ALL_CATEGORIES.includes(input.category)) return { ok: false, error: "Catégorie inconnue." };

  const rawPageCount = input.pageCount.trim();
  let pageCount: number | null = null;
  if (rawPageCount !== "") {
    const parsed = Number(rawPageCount);
    // Un livre de 0 page, de −3 pages ou de 12,5 pages n'existe pas : refuser
    // vaut mieux que stocker une valeur qui fausserait « pages lues » (§4.5).
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return { ok: false, error: "Le nombre de pages doit être un entier positif." };
    }
    pageCount = parsed;
  }

  return {
    ok: true,
    payload: {
      title,
      series_name: trimmedOrNull(input.seriesName),
      issue_number: trimmedOrNull(input.issueNumber),
      authors: trimmedOrNull(input.authors),
      publisher: trimmedOrNull(input.publisher),
      page_count: pageCount,
      category: input.category,
    },
  };
}
