@AGENTS.md

# Objectif PAL — contexte projet

> Lis `docs/product-specs.md` avant toute chose : c'est la source de vérité du produit.

## Règle de maintenance

Toute décision prise en conversation (règle produit, choix technique, TBD tranché) est reportée dans
`docs/product-specs.md`. Ce fichier-ci ne bouge que si la stack, le statut ou la structure du projet changent.

## Ce que c'est

PWA mobile-first adossée à l'émission **Objectif PAL** (Prem & Léna), sur la réduction de la PAL (pile à lire).

**Objectif principal : répertorier mes lectures et en tirer des statistiques**, assez propres pour être données
à Léna à l'antenne. Le jeu (barème, objectifs mensuels, compétition) vient après.

Solo au lancement, modèle de données multi-utilisateur dès le départ.

- UI en français. Code en anglais.

## Statut

> **L'app tourne en prod (https://objectif-pal.vercel.app, Vercel lié au repo GitHub) et remplit sa promesse
> de base : scan caméra (zxing-wasm) → « je commence / j'achète » → journal (terminer/abandonner/reprendre,
> note + avis) → bilan mensuel au barème copiable pour l'antenne, vue PAL (§4.6) avec annulation d'achat.
> Base Supabase complète (schéma §7 + 559 516 lignes GCD indexées), 4 connexions externes vérifiées, frontière
> base typée, moteur de scoring testé, export JSON/CSV. **Le P0 est fait**, et un audit complet (issue #20,
> PRs #21→#27) a durci fiabilité, sécurité, perf et cohérence (85 → 155 tests, migration d'intégrité + index perf).
> Les **stats essentielles** §4.5 sont livrées (moteur `lib/stats/` + vue `/stats` avec courbe de PAL,
> PRs #37/#38) et le **P1 jeu** aussi : objectifs mensuels §4.11 (cibles, jauges, bonus +3) et distinctions
> §4.4 (dans le bilan et le texte copiable) — 155 → 198 tests. Le carnet avance : scan-bibliothèque (#10),
> finitions UX scan (#35), filtres du journal (#34), tech-debt #32 (lots A+B), replis couvertures
> OpenLibrary/Inventaire (#44) et **photo de couverture (#33 — le filet ultime, bucket Storage public)**
> livrés. **La vague du 19/07/2026 après-midi (#52→#61)** : la chaîne couverture passe à **5 crans**
> (BnF Couvertures + epagine, specs §5.4) avec **réparation automatique** du cache et des liens morts
> (self-healing, garde SSRF), la **saisie manuelle** pré-remplit la couverture, explique le « image oui,
> infos non » et **alimente `barcode_cache` (source manual)**, le marqueur GCD `#[nn]` est éradiqué, et le
> **scanner ressuscité** (#60 : le WASM était derrière le mur d'auth → cache SW empoisonné ; post-mortem
> complet dans l'issue, contrat de test anti-régression + test d'intégration prod) — 198 → 240 tests.
> La **vue Bibliothèque #49 est livrée** (PR #63). **La refonte UX/UI #64 est livrée** (19/07/2026,
> PRs #75/#77/#79/#81/#82/#83/#85, specs `docs/design-specs.md`) : identité « nuit du plateau » (tokens +
> dégradé signature, thème sombre unique), **nav 5 onglets avec scan central** (la PAL est un segment de la
> Biblio, les Stats un segment du Bilan ; `/pal` et `/stats` redirigent), famille de composants
> `components/ui/`, dérivation partagée de la santé de la PAL (`lib/pal/health.ts`), et micro-interactions
> (confettis au « Terminé ✓ », `prefers-reduced-motion`) — 240 → 268 tests.
> **La possession est livrée le 20/07/2026** (#101 lots A et B, PRs #103/#104, specs §4.13) : l'app connaît
> enfin **l'étagère d'avant** — « je possède » (sans malus), « j'ai déjà lu » (lecture passée, date
> facultative) et « je ne le possède plus » (don, revente, les points restant au bilan). Le principe qui
> structure tout : **l'appartenance à la pile se dérive sans date, seuls les mouvements datés alimentent les
> flux** — scanner 80 livres n'affiche aucun pic. Table `ownerships`, `finished_at`/`started_at` nullables,
> et la règle de pile désormais partagée par les **trois** surfaces (Pile, Stats, Biblio) — 268 → 399 tests.
> Restent : **#74** (icônes PWA à la nouvelle identité — livrable graphique, différé), **#101 lot C**
> (rafale + boîte de finition), **#100** (édition de fiche + fusion de doublons), #30 (prérequis à lever),
> #32 lot C (différé volontaire), et la dette de suivi #76/#78/#84.**

## Stack

| Couche | Tech |
|---|---|
| Front | Next.js 16 (App Router) + Tailwind 4 |
| Back | Server Actions + Route Handlers |
| Base | PostgreSQL via Supabase |
| Auth | Supabase Auth — **Google OAuth** (⚠️ `redirectTo` construit sur l'origine réelle, pas une constante) |
| **Identification d'un scan** | **GCD (Grand Comics Database), importé chez nous** — 559 516 lignes (~75 Mo) : comics VO **et BD franco-belge**. Match par code-barres, par préfixe, ou par ISBN |
| **Identification VF** | **BnF** (API SRU, gratuite, sans clé) — dépôt légal : BD, manga VF, romans. 95 % mesuré |
| Couvertures ISBN | **Google Books** (clé obligatoire — 429 systématique sans clé) → **OpenLibrary** → **Inventaire.io** → **BnF Couvertures** (API officielle, 500 = absente) → **epagine** (CDN libraires, hotlink assumé en dernier cran) — replis du 19/07/2026 |
| Enrichissement VO | Metron — **couverture** + `series_type` (Basic Auth, **côté serveur**) |
| Scan | **zxing-wasm** (ZXing C++ en WASM — le port JS de ZXing ne décode pas les suppléments, mesuré) |
| Hébergement | Vercel |
| Tests | Vitest (logique de scoring) |

**Attribution obligatoire** : données GCD et Metron en CC BY-SA 4.0 → l'app doit créditer les deux bases.

## Les données GCD

- Dump source : `C:\Users\premg\Downloads\current\2026-07-01.sql` (3,76 Go, régénéré tous les 15 jours sur
  comics.org).
- `scripts/gcd-export.mjs` → `data/gcd_issues.csv` (559 516 lignes) + `data/gcd_series.csv` (121 308 séries).
  **`data/` est gitignoré** : les CSV se régénèrent depuis le dump en ~3 min.
- `scripts/gcd-inspect.mjs` et `scripts/gcd-barcodes.mjs` : les parseurs en flux qui ont produit les mesures
  citées dans les specs. À rejouer à chaque nouveau dump.

Le **calcul du score vit en TypeScript** (`lib/scoring/`), pas en SQL : la base ne stocke que des faits
(lectures, achats, objectifs), le score est dérivé. Testable, modifiable sans migration.

## Les types de la base

`lib/supabase/database.types.ts` est **généré** depuis le schéma de prod et typé sur les trois clients :
une colonne renommée casse le build, pas la prod. **Après chaque migration appliquée : `npm run db:types`**
— sinon les types mentent en silence. Le fichier ne s'édite jamais à la main (la régénération l'écrase).

## Conventions

- **Nommage** : tout en anglais, pas d'abréviations (`pageCount` pas `pc`). camelCase pour les
  fonctions/variables, PascalCase pour les types, SCREAMING_SNAKE_CASE pour les constantes de config,
  kebab-case pour les fichiers.
- **Commentaires** : en français, c'est très bien.
- **Pas de valeur magique** : le barème vit dans une constante unique, jamais recopié en dur.
- Mobile-first, a11y, composants réutilisables.

## Git

GitHub Flow : `main` toujours déployable, une branche par feature (`feat/<nom-court>`), PR pour merger.
Si une PR contient une migration `supabase/migrations/` → l'appliquer sur Supabase avant le merge.

## Prochaines étapes

1. **#101 lot C — la rafale** : mode scan d'étagère qui ne s'arrête jamais (résolution asynchrone, capture
   systématique), **boîte de finition** persistante (`scan_inbox`) pour les scans à compléter — introuvable,
   « image oui, infos non », pas de code-barres → photo comme capture —, et **correction de catégorie
   inline** dans la liste de session. Les 9 cas sont analysés dans l'issue. C'est ce qui rend le scan
   d'étagère réellement utilisable (§4.13).
2. **#100 — gestion de la Biblio** : édition de fiche en formulaire complet (indispensable aux livres saisis
   à la main, qui n'ont pas de code-barres à rescanner) + fusion de doublons. Rend le lot C plus confortable
   (la catégorie proposée devient corrigeable partout).
3. **#74 — icônes PWA à la nouvelle identité** : dernier reliquat de la refonte #64 (livrable graphique
   PNG/favicon, `background_color`/`theme_color` déjà migrés). Différé, à traiter au moment choisi.
4. **Dette de suivi de la refonte** : #76 (vitest casse en worktree + scanne `.claude/worktrees`),
   #84 (variante `danger` sur `Button`). **#78 est résolu** : `bookToMovement` est le réducteur partagé, et
   #101 l'a étendu aux trois surfaces.
5. **#30** (analyses avancées §4.5 — prérequis à lever, dont le trigger `occurred_at`).
6. **#32 — reste le lot C seul** (pagination du journal, volontairement différée le 19/07/2026 : à
   déclencher vers 200-300 lignes de journal ou à l'ouverture multi-utilisateur ; les filtres #34 migreront
   alors côté requête — l'index de tri est déjà posé).

**Point ouvert à traiter au moment du scan** : deviner la catégorie du barème pour la **VF** (BD vs manga vs
roman) à partir de Google Books — on n'a que des indices (éditeur, pages, langue). La catégorie proposée doit
rester **corrigeable en un tap**.
