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
> Le **lot C** suit le même jour : **scan d'étagère en rafale** — la chaîne ne s'arrête jamais (capture
> découplée de la résolution), **boîte de finition** persistante (`scan_inbox`) où atterrit tout ce qui
> demande de l'attention, et **correction de catégorie inline** avec marqueur sur les devinettes VF —
> 399 → 416 tests. **#100 est livré le même jour** (specs §4.12) : **édition de fiche** en formulaire complet
> — indispensable aux livres saisis à la main, qui n'ont pas de code-barres à rescanner — et **fusion de
> doublons** en une transaction SQL (`merge_books`), qui refuse deux codes-barres différents et transfère le
> code au livre conservé quand il n'en a pas — 416 → 436 tests. **#108 est livré le même jour** (specs §4.13) :
> le **livre sans code-barres photographié dans la boucle** de rafale — le neuvième et dernier cas de
> l'étagère. Passer à la photo **démonte** le scanner (deux flux caméra ne cohabitent pas) et en revenir le
> **remonte** (caméra fraîche, reprise « toute seule ») ; la couverture part dans la boîte de finition avec
> l'intention de la session, indexée `{user_id}/inbox-{uuid}.webp` — 436 → 440 tests. **La soirée du
> 20/07/2026 clarifie la possession (#113, #114, #117)** : l'**emprunt** existe enfin (« Lu — emprunt » en
> rafale, 3ᵉ valeur de `scan_intent` ; à l'unité « Je l'ai déjà lu » déclare la possession par défaut avec
> case « c'était un emprunt »), la Biblio n'a plus qu'**UN geste de sortie** (« Retirer de ma bibliothèque »
> = ne plus posséder, lectures et points TOUJOURS conservés ; le livre-erreur sans trace disparaît proprement,
> les cédés sortent de la liste — l'ancien bouton « Retirer » destructeur est supprimé, specs §4.12), et le
> **rachat rouvre la possession close** (#117, bug débusqué en review : les 3 portes d'acquisition rouvrent
> `disposed_at`, avec filet pur dans `derivePileStatus`) — 440 → 445 tests. **#87 est livré le 13/08/2026** :
> le logo HD de l'émission (reçu de Léna, fond blanc 1280×720) alimente `scripts/gen-brand.mjs` refondu —
> détourage par remplissage depuis les bords (les lettres blanches d'« OBJECTIF » interdisent la suppression
> globale du blanc), séparation emblème/titre par composantes connexes (le rayon bleu est soudé au « O » :
> coupe chirurgicale dans le noir fusionné, appliquée à l'emblème seul), anti-halo + décontamination des
> bords, icônes en PNG palette (÷5 sur le poids) — icônes, maskable, favicon et splash enfin **nets**.
> Restent : #32 lot C (différé volontaire) et l'idée produit #97 (passerelle League of Comic Geeks).
> **Le 14/08/2026, décision d'ouvrir à 30-40 utilisateurs (plafond ~100, à coût nul)** : audit complet en
> 4 passes (base/RLS, accès données, chaîne externe, auth/exploitation), plan « Objectif 100 » (epic #182),
> et **la Phase 0 livrée le jour même** (PRs #183→#188, 445 → 521 tests) : inscription sur **allowlist**
> (`allowed_emails` + plafond dans le trigger), RPC de quota durcie (`consume_action_quota(kind)`, seuils en
> SQL), **quotas globaux** Google Books (900/j) et Metron (15/min) avec panne ≠ absence
> (`ProviderUnavailableError`), **cache négatif** (`barcode_misses` TTL 7 j, `cover_checked_at` TTL 30 j —
> un introuvable ne repaie plus la cascade), réparation de couvertures **métrée** (5/min + tampon persistant
> 7 j + file client à 2), **troncature PostgREST éradiquée** (`fetchAllRows` sur export et `reading_events`),
> cache partagé assaini (couvertures d'hôtes connus seuls, `created_by`, bornes 1 000 car.), et
> **observabilité** : Sentry (erreurs seulement, DSN à poser) + CI GitHub Actions (tests+build par PR,
> contrat #60 quotidien contre la prod).**
> **Le 31/08/2026, la vague des gestes groupés (#256/#257/#258, PRs #259/#260/#261, maquette
> `docs/protos/proto-bulk-actions.html`, 603 → 610 tests)** : **sélection multiple de la PAL** (« Marquer
> comme lus » à date commune ou en lecture passée 0 point — plan pur `lib/books/bulk-read-plan.ts` —, « Je ne
> le possède plus » groupé confirmé, « on continue et on rapporte »), **écart groupé de la boîte de finition**
> (un UPDATE `in(ids)`, compte honnête), et **alignement de catégorie par série** depuis l'édition de fiche
> (compte serveur, toast au compte réel de l'UPDATE ; mois clos resynchronisés tout seuls — le trigger
> `books_bump_fact_version` couvre `category`). Specs §4.6, §4.12 et §4.13 à jour.
> **Les 1-2/09/2026, la carte de partage en image (§4.15, #263, PR #264, 610 → 622 tests)** — le bilan
> mensuel en **carte 1024×1536** stylée pour l'antenne : « Partager mon bilan » ouvre une feuille
> **Texte / Image**, 10 thèmes (fonds générés par Prem, calibrés **au pixel** dans le labo
> `docs/protos/proto-share-cards.html` : mode iso + différence d'images, planches-spécimens pour les
> polices, masques photo en ellipse au bord intérieur des cadres, galerie validée avec Léna).
> `lib/share/` : coordonnées typées + dérivation pure testée + **moteur canvas client** (parité CSS
> explicite, rendu sur l'appareil, rien ne part sur un serveur), partage natif de fichier + repli
> téléchargement, 23 woff2 **auto-hébergés** (RGPD) et fonds WebP sous `public/share/`. Le petit
> spectateur du Profil est aussi de cette vague (#252, PR #253) : « 👀 Voir mon profil comme mon
> cercle » — les RPC servent « amis ou soi-même », parité prouvée en CI. La version « classique »
> de la carte (distinctions en couvertures) reste remisée (§4.15).

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

1. **Ouverture (epic #182)** — **Phases 1 ET 2-couvertures livrées le 15/08/2026** (PRs #190→#212) :
   backups hebdo chiffrés validés jusqu'à la restauration, région `cdg1` co-localisée, politesse de la
   chaîne externe (UA identifiant, budget 7 s, rafale en file), SW auto-réparant (garde #60 au précache,
   v5), finitions base + **certification zéro dérive** (91 objets), refresh GCD en staging+bascule (~ms
   d'indisponibilité), **cloisonnement RLS prouvé chaque jour en CI** (2 comptes de test), catalogue GCD
   caché 24 h, **suppression de compte RGPD** (cascade exercée sur compte jetable) + purge mensuelle
   versionnée, **couvertures rapatriées** (#208 : 610 internes / 0 hotlink, quotidien + cacheControl 1 an),
   **Sentry armé et vérifié** (projet EU `objectif-pal`), **ouverture plafonnée** (#211 : tout compte
   Google entre, jauge 100 — l'URL peut être annoncée à l'antenne), et **#32 lot C livré** (#212 :
   journal paginé 50/page, filtres côté requête, ordre #146 contractualisé dans la vue `journal_entries`).
2. **Amis v1 (§4.14) est presque complet le 15/08/2026** — spécifié, complété au tour de spec, puis
   **lots A et B livrés le jour même**. **Lot A (#226/#227)** : pseudo unique + porte du cercle (les
   défauts Google/email ne sont jamais cherchables), `friendships` en paire canonique (demande croisée =
   acceptation), recherche par préfixe bornée sous quota, section Cercle au Profil, pastille, export.
   **Lot B (#229)** : les bilans comparés — `get_circle_monthly_reports`/`get_circle_monthly_picks`
   (`security definer`, amis acceptés, jamais une lecture brute — **cloisonnement prouvé en CI** par le
   test d'isolation étendu), parsing défensif du jsonb, classements par mois clos et cumul annuel
   (ex-aequo même rang, « — » hors rang), fiche ami + vue comparée sous `/profil/cercle`, **job Actions
   du 1er du mois** (`materialize-monthly-reports.mts` via tsx — le moteur réutilisé, zéro barème
   dupliqué), et le shell passé à UN appel réseau (`count_pending_friend_requests`). **Lot C (#230)
   livré dans la foulée** : la **carte de paliste** (dérivation pure des seuls agrégats — distinctions
   cumulées, meilleur mois avec égalité au plus récent, total de l'année, lectures — UN composant pour
   mon Profil ET la fiche ami : l'aperçu honnête est structurel), le **Profil en espace personnel**
   (identité + carte + cercle, réglages descendus en sous-page `/profil/reglages`, attribution
   maintenue au pied — licence §6), et le parseur d'agrégat resserré (format du mois). **Amis v1 est
   complet**, et le 16/08 l'affine encore : carte héros au palmarès en médailles (#234, maquette validée)
   et **terminés du mois en couvertures** (#236 : métadonnées publiques du livre dans la ligne d'agrégat,
   grille plafonnée-dépliable, feuille au tap avec ISBN copiable — ⚠️ après déploiement, bump one-shot
   des `user_fact_versions` + run manuel du job pour rematérialiser le parc). Et **le reveal appartient
   à l'émission (#243)** : le dernier mois clos reste verrouillé au cercle (`report` NULL servi, picks
   filtrés, carte/cumul auto-exclus) jusqu'au bouton « Révéler au cercle » du Bilan ou à la bascule
   auto au 1ᵉʳ du mois suivant — prédicat de temps `is_month_revealed`, zéro cron, sens unique
   structurel (pas de policy UPDATE/DELETE sur `monthly_reveals`), prouvé en CI. Cap : premiers bilans
   comparés à l'antenne le 1er septembre — le job doit avoir tourné.
   ⚠️ Le sur-fetch de la PAL (lot B défait par #101) reste à retraiter, avec `ownerships` dans l'équation.

**Point ouvert à traiter au moment du scan** : deviner la catégorie du barème pour la **VF** (BD vs manga vs
roman) à partir de Google Books — on n'a que des indices (éditeur, pages, langue). La catégorie proposée doit
rester **corrigeable en un tap**.
