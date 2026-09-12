import { isMainCover, RESOLUTION_BUDGET_MILLISECONDS, type ResolutionDeps } from "@/lib/resolution/resolve";

/**
 * Les candidates de couverture (#276, epic #274) — ce que TOUTES les sources
 * connaissent pour un livre, pour que l'utilisateur choisisse. La cascade du
 * scan, elle, s'arrête à la première image (zéro coût sur le chemin heureux) ;
 * ici on interroge tout le monde **en parallèle**, à la demande seulement,
 * sous le budget global de résolution. Pur : les deps sont injectées, testé
 * sans réseau.
 */

export type CoverCandidateSource = "metron" | "google_books" | "open_library" | "inventaire" | "bnf" | "epagine" | "open_library_edition";

export type CoverCandidate = {
  url: string;
  source: CoverCandidateSource;
  /** L'étiquette sous la vignette — en français, source d'abord. */
  label: string;
  /** La variante dont l'UPC égale le code scanné (VO) : entourée, c'est l'exemplaire tenu. */
  preselected: boolean;
  /** Une AUTRE édition (#277) : jamais celle qu'on tient — l'étiquette le dit, la candidate n'est jamais posée seule. */
  edition?: { publisher: string | null; year: string | null };
};

export type CoverCandidatesResult = {
  candidates: CoverCandidate[];
  /** Une source n'a pas répondu (panne, quota, budget) : la liste est peut-être incomplète. */
  degraded: boolean;
};

const SOURCE_LABELS: Record<Exclude<CoverCandidateSource, "metron" | "open_library_edition">, string> = {
  google_books: "Google Books",
  open_library: "OpenLibrary",
  inventaire: "Inventaire",
  bnf: "BnF",
  epagine: "epagine",
};

type CandidateBook = {
  barcodeType: "isbn" | "upc" | null;
  barcode: string | null;
  isbn: string | null;
};

/** Dédoublonne par URL exacte, ordre d'arrivée conservé. */
const dedupe = (candidates: CoverCandidate[]): CoverCandidate[] => {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.url)) return false;
    seen.add(candidate.url);
    return true;
  });
};

/**
 * Lance chaque source en parallèle et rend ce qui est arrivé dans le budget.
 * `Promise.allSettled` ne livre rien avant la fin : on note chaque résultat à
 * son arrivée et on lit le tableau quand le budget tombe.
 */
async function raceWithBudget<T>(
  tasks: (() => Promise<T[]>)[],
  budgetMs: number,
): Promise<{ results: T[][]; degraded: boolean }> {
  const results: T[][] = tasks.map(() => []);
  let degraded = false;
  let settled = 0;
  const all = Promise.all(
    tasks.map((task, index) =>
      task()
        .then((value) => {
          results[index] = value;
        })
        .catch(() => {
          degraded = true;
        })
        .finally(() => {
          settled += 1;
        }),
    ),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, budgetMs);
  });
  await Promise.race([all, timeout]);
  clearTimeout(timer);
  if (settled < tasks.length) degraded = true;
  return { results, degraded };
}

export async function listCoverCandidates(
  book: CandidateBook,
  deps: ResolutionDeps,
  budgetMs: number = RESOLUTION_BUDGET_MILLISECONDS,
): Promise<CoverCandidatesResult> {
  if (book.barcodeType === "upc" && book.barcode) {
    const { results, degraded } = await raceWithBudget([() => metronCandidates(deps, book.barcode as string)], budgetMs);
    return { candidates: dedupe(results.flat()), degraded };
  }
  if (book.barcodeType === "isbn" && book.isbn) {
    const isbn = book.isbn;
    const single = (source: Exclude<CoverCandidateSource, "metron" | "open_library_edition">, lookup: () => Promise<string | null>) => async () => {
      const url = await lookup();
      return url ? [{ url, source, label: SOURCE_LABELS[source], preselected: false }] : [];
    };
    const { results, degraded } = await raceWithBudget(
      [
        single("google_books", async () => (await deps.googleBooks.resolveIsbn(isbn))?.coverUrl ?? null),
        single("open_library", () => deps.openLibrary.findCoverByIsbn(isbn)),
        single("inventaire", () => deps.inventaire.findCoverByIsbn(isbn)),
        single("bnf", () => deps.bnfCovers.findCoverByIsbn(isbn)),
        single("epagine", () => deps.epagine.findCoverByIsbn(isbn)),
      ],
      budgetMs,
    );
    return { candidates: dedupe(results.flat()), degraded };
  }
  // Sans code exploitable (saisie manuelle) : rien à demander aux sources —
  // les autres éditions (lot E) et la photo restent.
  return { candidates: [], degraded: false };
}

/** VO : la principale puis chaque variante, la variante scannée entourée. */
async function metronCandidates(deps: ResolutionDeps, barcode: string): Promise<CoverCandidate[]> {
  const issue = await deps.metron.findIssueByUpc(barcode);
  if (!issue) return [];
  const candidates: CoverCandidate[] = [];
  if (issue.mainCoverUrl) {
    candidates.push({
      url: issue.mainCoverUrl,
      source: "metron",
      label: "Metron · Couverture principale",
      // La vérité est dans le code-barres (review #281) : 4ᵉ chiffre du
      // supplément à 1 = l'exemplaire tenu EST la principale. Une variante
      // que Metron ignore (cover H mesurée) n'entoure rien — c'est le cas
      // où l'on choisit à la main, ou l'on photographie.
      preselected: isMainCover(barcode),
    });
  }
  for (const variant of issue.variants) {
    candidates.push({
      url: variant.coverUrl,
      source: "metron",
      label: `Metron · ${variant.name}`,
      preselected: variant.upc !== null && variant.upc === issue.matchedVariantUpc,
    });
  }
  return candidates;
}

/**
 * Les autres éditions (#277, lot E) — SÉPARÉ de `listCoverCandidates` : jamais
 * appelé à l'ouverture ni au scan, seulement au tap « Chercher d'autres
 * éditions ». Une couverture d'édition sœur est proposée, jamais posée toute
 * seule : les romans changent souvent de couverture entre éditions.
 */
export async function listEditionCandidates(
  query: { title: string; author: string | null },
  deps: Pick<ResolutionDeps, "openLibrary">,
  budgetMs: number = RESOLUTION_BUDGET_MILLISECONDS,
): Promise<CoverCandidatesResult> {
  const { results, degraded } = await raceWithBudget(
    [
      async () =>
        (await deps.openLibrary.searchEditionCovers(query)).map((edition) => ({
          url: edition.coverUrl,
          source: "open_library_edition" as const,
          label: editionLabel(edition, query.title),
          preselected: false,
          edition: { publisher: edition.publisher, year: edition.year },
        })),
    ],
    budgetMs,
  );
  return { candidates: dedupe(results.flat()), degraded };
}

/** Comparaison de titres sans casse, accents ni ponctuation. */
const normalizeTitle = (title: string): string =>
  title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * L'étiquette dit la vérité (review #282) : quand l'œuvre trouvée n'a pas le
 * titre cherché (le cas mesuré : *The Vampire Slayer* 2022 → *Buffy the
 * Vampire Slayer* 2014), son titre passe devant — l'utilisateur voit que ce
 * n'est pas son livre, et peut quand même le prendre.
 */
const editionLabel = (edition: { workTitle: string | null; publisher: string | null; year: string | null }, searchedTitle: string): string => {
  const detail = [edition.publisher, edition.year].filter((part): part is string => part !== null).join(" ");
  const otherWork = edition.workTitle !== null && normalizeTitle(edition.workTitle) !== normalizeTitle(searchedTitle) ? edition.workTitle : null;
  const head = otherWork ?? "Autre édition";
  return detail.length > 0 ? `${head} · ${detail}` : `${head} · OpenLibrary`;
};
