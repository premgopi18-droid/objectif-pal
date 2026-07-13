# Objectif PAL — Specs produit

> Source de vérité du produit. Toute décision prise en conversation atterrit ici.

## Le produit

PWA mobile-first adossée à l'émission **Objectif PAL** (Prem & Léna), dont le sujet est la réduction de la
PAL (pile à lire).

**Objectif principal : répertorier mes lectures et en tirer des statistiques et des analyses**, suffisamment
propres et lisibles pour que je puisse **donner mes chiffres à Léna pour l'émission**. Tout le reste est au
service de ça.

On scanne un bouquin quand on le commence, l'app le classe dans la bonne catégorie, suit son état de lecture
avec ses dates, et en déduit des stats.

- Langue UI : français. Langue du code : anglais.
- Solo au lancement, **modèle de données multi-utilisateur dès le départ** (`user_id` partout) pour brancher
  la comparaison Prem vs Léna plus tard sans migration douloureuse.

### Priorités

| Rang | Bloc | Pourquoi |
|---|---|---|
| **P0** | **Journal de lecture** (scan, catégorie, états, dates) + **achats** + **bilan mensuel au barème** (le décompte par catégorie que je donne à Léna, score inclus) + analyses | C'est le produit. Le bilan est le livrable ; le score n'est qu'une multiplication du décompte, il vient gratuitement avec. |
| **P1** | Objectifs mensuels (cible par catégorie, jauge, bonus +3) | Le jeu de l'émission. Ne sert à rien sans données : on le branche quand P0 tourne. |
| **P2** | Compétition Prem vs Léna (comparaison mensuelle, « meilleur paliste » +5) | Plus tard. Le modèle de données est prêt à l'accueillir. |

La conséquence concrète : **la saisie doit être irréprochable avant tout le reste**. Une stat n'est bonne que
si le journal est complet, donc scanner/classer/dater un bouquin doit être rapide et sans friction — c'est là
qu'on met l'effort.

## Catégories

Six catégories, exclusives. C'est la catégorie qui détermine les points.

| Catégorie | Code | Ce que c'est |
|---|---|---|
| Issue | `issue` | Un fascicule VO à l'unité (~20-30 pages, pas d'ISBN, code-barres UPC) |
| Manga | `manga` | Un tome de manga |
| BD | `bd` | Un album franco-belge |
| Comics | `comics` | Un recueil VO (TPB / trade paperback) qui compile plusieurs issues |
| Omnibus | `omnibus` | Un gros volume compilant plusieurs tomes/arcs |
| Roman | `roman` | Un roman (texte, sans images) |

## Barème

| Événement | Points |
|---|---|
| Issue terminée | **+0,5** |
| Manga terminé | **+1** |
| BD terminée | **+2** |
| Comics terminé | **+3** |
| Omnibus terminé | **+5** |
| Roman terminé | **+5** |
| Livre acheté et pas lu | **−1** |
| Objectif du mois atteint | **+3** |
| _Meilleur paliste du mois_ | _+5 — **parqué**, arrivera avec le mode multi_ |

### Règles de calcul

1. **Les points de lecture sont crédités à la date de fin de lecture.** Un bouquin commencé en mars et terminé
   en avril rapporte ses points **en avril**. Commencer une lecture ne rapporte rien — c'est ce qui empêche de
   gonfler son score en ouvrant dix bouquins.
2. **Malus achat : −1 immédiat, effaçable.** Tout livre acheté dans le mois retire 1 point dès l'enregistrement
   de l'achat. Si ce livre est **terminé avant la fin du même mois**, le malus est annulé (et les points de
   lecture s'ajoutent normalement). À la clôture du mois, il reste donc −1 par livre acheté ce mois-là et non
   terminé.
   - Un livre acheté en mars et terminé en avril : le −1 de mars **reste acquis** en mars (le mois est clos),
     et les points de lecture tombent en avril.
3. **Objectif mensuel = un nombre de bouquins par catégorie.** Ex : « 3 mangas + 1 BD + 2 issues ». Le bonus
   **+3 est all-or-nothing** : il faut atteindre *toutes* les cibles déclarées pour l'empocher.
   Seules les lectures **terminées dans le mois** comptent pour l'objectif.
4. **Score du mois** = somme des points des lectures terminées dans le mois
   − nombre d'achats du mois non terminés à la clôture
   + 3 si l'objectif du mois est atteint.
5. Les demi-points existent (issue = 0,5) → le score est un **décimal**, jamais un entier.

## Fonctionnalités

### 1. Scanner un bouquin

Le geste central : je commence un livre, je scanne son code-barres, il entre dans mes lectures.

- Scan via la caméra (BarcodeDetector natif quand dispo, **ZXing** sinon — cf. le point sur le supplément
  ci-dessous).
- **Classement automatique** de la catégorie, **proposé et corrigeable en un tap**. La correction de
  l'utilisateur fait foi, toujours.

#### Sources de métadonnées

| Source | Rôle | Ce qu'elle apporte |
|---|---|---|
| **Metron** ([metron.cloud](https://metron.cloud)) | Primaire pour la **VO** | Le seul à indexer l'**UPC** des comics (`/issue/?upc=…`) **et** à exposer un `series_type` : *Single Issue, Trade Paperback, Hardcover, Omnibus, Graphic Novel, Annual, One-Shot*. Donne donc **la catégorie du barème directement**, sans heuristique. |
| **Google Books** | Primaire pour la **VF** (BD, manga, roman) | Titre, auteurs, éditeur, pages, couverture, langue, via ISBN. |
| **Open Library** | Fallback | Idem, quand Google Books est muet. |

#### Authentification et secrets

**Metron n'a pas de clé API** : c'est du **HTTP Basic Auth avec les identifiants d'un compte Metron**. Le couple
identifiant / mot de passe joue le rôle de clé.

- On utilise un **compte de service dédié au projet** (pas un compte perso).
- Identifiants en **variables d'environnement serveur** : `.env.local` en local, variables Vercel en prod.
  **Jamais de préfixe `NEXT_PUBLIC_`** — ça partirait dans le bundle client, lisible dans les DevTools.
- Le client **n'appelle jamais Metron directement** : le scan envoie le code-barres à un **Route Handler**
  (`/api/lookup/[barcode]`) qui interroge Metron côté serveur et renvoie un résultat normalisé.
- **Chaque résolution réussie est mise en cache en base** : un bouquin n'est jamais résolu deux fois.

Google Books fonctionne **sans clé** (quota par IP ; une clé gratuite le relève si besoin). Open Library n'en
demande aucune.

**Throttle Metron : 20 req/min, 5 000 req/jour — par compte authentifié.** En solo (ou à deux), le cache rend
ces limites inatteignables. **Mais en cas de commercialisation, tous les utilisateurs partageraient ce compte
unique**, et leurs CGU parlent d'un « usage personnel normal » — ce qu'une app publique n'est plus. À ce
moment-là, le **dump GCD auto-hébergé n'est plus une optimisation mais la seule sortie propre** (cf. backlog).

**Décision : Metron d'abord, GCD en réserve.** On démarre sur l'API Metron (rien à héberger). Le dump de la
**Grand Comics Database** (2 M+ d'issues, champ `barcode`, CC BY-SA 4.0, usage commercial autorisé avec
attribution) reste le plan de repli si la couverture ou les CGU coincent — c'est ce que fait CLZ avec sa base
« Core ». Ni League of Comic Geeks (pas d'API publique) ni CLZ (base propriétaire) ne sont exploitables : tous
deux maintiennent leur propre base, ils ne « trouvent » pas les UPC ailleurs.

#### Résolution = une interface de providers

**Contrainte d'architecture, décidée pour ne pas se marier à une source.** La résolution des métadonnées vit
derrière une interface (`resolveByBarcode(barcode)`, `resolveByIsbn(isbn)`), avec des implémentations
interchangeables essayées **en cascade** :

`Metron` → `Google Books` → `Open Library` → (plus tard) `GCD local` → saisie manuelle.

Ajouter ou remplacer une source devient un branchement, pas une réécriture. C'est ce qui rend le débat
« Metron ou GCD » peu risqué.

#### Couverture de l'indé — question ouverte, à mesurer

La collection contient **du Marvel/DC mais aussi de l'indé**, et l'indé doit marcher. Or la couverture réelle de
Metron par éditeur n'est **pas vérifiable publiquement** (leur site bloque les bots). Ce qu'on peut raisonner :

- Metron est alimenté à partir des **sorties hebdo (NCBD)** → l'indé distribué en librairie (Image, IDW, Dark
  Horse, BOOM!, Vault, Oni, Titan) a de bonnes chances d'y être, comme Marvel et DC.
- Le trou probable : **small press, auto-édition, Kickstarter, vieux fascicules indé**. Et pour ceux-là,
  **aucune base ne sauve** (ni GCD, ni CLZ) : un tirage à 500 exemplaires n'est dans aucun catalogue. **La saisie
  manuelle reste le filet, quelle que soit la source.**
- GCD couvre nettement mieux le rétro et l'indé distribué (2 M+ issues, tous éditeurs, non-US inclus).

**Action décidée : mesurer avant de choisir.** Script `scripts/metron-coverage.mjs` → on interroge Metron avec
~15 comics réels de l'étagère, **indés obscurs inclus**, et on regarde le taux de réussite. Si le taux est mauvais
sur l'indé, on attaque le dump GCD immédiatement (l'interface de providers rend la bascule indolore).

**Deux contraintes de conception qui découlent de ce choix** — elles comptent plus que le choix lui-même :

1. **On stocke le code-barres brut** (les 12 chiffres **et** le supplément de 5) sur chaque livre, tel que scanné.
   Si on change de source demain, on **re-résout tout l'historique sans re-scanner un seul bouquin**.
2. **Toute résolution réussie est mise en cache dans notre base.** Au fil des mois on se constitue notre propre
   table `barcode → livre`, gratuitement. C'est un actif, et ça nous rend progressivement indépendants de la
   source externe.

**Licence** : les données Metron et GCD sont en **CC BY-SA 4.0** → commercialisation possible, à condition de
**créditer la source** dans l'app (et de repartager les données dérivées si on les redistribue — ce qui ne
touche pas le code applicatif).

#### Le cas des issues VO — le point dur

Un fascicule VO n'a **pas d'ISBN** : il porte un **UPC-A 12 chiffres + un supplément de 5 chiffres** collé à
droite. Ce supplément encode le **numéro d'issue, la variante de couverture et le tirage** — les 12 chiffres
seuls n'identifient que le *titre*, pas le numéro.

Problème : ce supplément est imprimé petit, et **l'API native `BarcodeDetector` ne le renvoie pas**. ZXing sait
le décoder, mais il faut qu'il soit net et cadré. **On ne peut donc pas compter dessus systématiquement.**

Parcours, avec dégradation propre :

1. **Supplément capturé** → `GET /issue/?upc=<12+5 chiffres>` sur Metron → tout est rempli, catégorie incluse.
   Zéro saisie.
2. **Supplément raté** (12 chiffres seuls) → on bascule sur la **saisie rapide série + numéro**, avec
   mémorisation de la série (la 2ᵉ issue de la même série prend trois secondes). Metron complète ensuite
   couverture / date / éditeur / pages à partir de série + numéro.
3. **TPB, omnibus, hardcover** → ils **ont un ISBN** : le scan classique marche, et Metron comme Google Books
   les retrouvent. Aucune difficulté.

#### Heuristique de classement (uniquement quand aucune source ne tranche)

Metron donne la catégorie pour la VO. Pour la VF, et en dernier recours :

| Signal | Catégorie proposée |
|---|---|
| `series_type` Metron = Single Issue / One-Shot / Annual | `issue` |
| `series_type` Metron = Trade Paperback / Hardcover / Graphic Novel | `comics` |
| `series_type` Metron = Omnibus | `omnibus` |
| Langue `ja` ou éditeur manga FR (Glénat, Kana, Pika, Kurokawa, Ki-oon, Tonkam…) + ~180-220 p | `manga` |
| Éditeur franco-belge (Dargaud, Dupuis, Le Lombard, Casterman, Delcourt…) + ~46-72 p | `bd` |
| Éditeur comics VF (Panini, Urban Comics…) | `comics` |
| Pas de signal illustré, catégorie « Fiction » / « Literary » | `roman` |

### 2. Mes lectures — le journal (P0)

La liste de tout ce que je lis et ai lu, avec :
- l'état : **en cours** / **terminé** (et **abandonné**, cf. TBD),
- la **date de début** et la **date de fin**,
- la catégorie, la série et le numéro de tome,
- filtres par état, catégorie, série, mois.

Une lecture est une **entrée distincte du livre** : relire un bouquin crée une nouvelle lecture.

C'est la table qui alimente tout le reste — les stats comme le score. Sa complétude prime sur tout : il doit
toujours être possible d'**ajouter une lecture à la main** (bouquin non scannable, typiquement une issue VO) et
de **corriger les dates après coup**.

**On démarre le journal à zéro** : pas de reprise des lectures antérieures à l'app. Les stats commencent au
premier mois d'usage. Une feature d'import rétroactif des mois passés reste possible plus tard (cf. backlog) —
le modèle de données ne doit rien faire qui l'empêche (aucune date ne doit être forcée à « maintenant » :
`started_at` et `finished_at` sont toujours librement saisissables).

### 3. Statistiques & analyses (P0)

Le livrable de l'app : des chiffres que je peux sortir tels quels pour l'émission.

#### 3.a Le bilan du mois au barème — **l'écran principal**

C'est **exactement ce que je donne à Léna** : le décompte du mois, ligne par ligne, dans les catégories du
barème. Rien d'autre n'a cette priorité.

| Ligne | Contenu |
|---|---|
| Une ligne par catégorie | Nombre de bouquins **terminés** dans le mois (issue, manga, BD, comics, omnibus, roman) |
| Achats non lus | Nombre de livres **achetés dans le mois et pas terminés** — ils comptent, c'est le malus |
| Total | Le score du mois, dérivé des lignes ci-dessus |

Les points sont une simple multiplication de ces comptes par le barème : dès qu'on a le décompte, on a le
score. **Le bilan et le score sont le même écran.** Il doit être copiable en un tap (texte propre, lisible tel
quel à l'antenne) et consultable pour n'importe quel mois passé.

#### 3.b Les analyses (second rideau)

Utiles pour moi et pour meubler l'émission, mais secondaires par rapport au bilan.

**Volume**
- Lectures terminées : ce mois-ci, cette année, au total — et le détail par catégorie.
- Pages lues (à partir du nombre de pages des métadonnées).
- Moyenne de lectures par mois, meilleur mois.

**Rythme**
- Durée moyenne d'une lecture (`finished_at − started_at`), par catégorie.
- Lectures en cours en ce moment (et depuis combien de temps — les lectures qui traînent).

**Santé de la PAL** — *la stat centrale de l'émission*
- Entrées vs sorties : achats du mois contre lectures terminées du mois.
- **Solde de PAL** : est-ce qu'elle fond ou est-ce qu'elle grossit ? Courbe cumulée dans le temps.
- Taille de la PAL à date (achats non lus).

**Répartition**
- Par catégorie, par éditeur, par série.
- Séries en cours (combien de tomes lus, quel est le suivant).

Les quatre familles (bilan, volume, rythme, santé de la PAL, répartition) sont toutes retenues — mais dans cet
ordre.

### 4. Achats (P0)

Enregistrer un achat (scan ou saisie) avec sa date. Il sert deux fois :
- il alimente la **PAL** (« acheté pas lu »), le solde entrées/sorties et **la ligne « achats non lus » du
  bilan** ;
- il déclenche le **malus −1** du barème.

Un achat se « convertit » en lecture quand on commence le livre.

### 5. Score du mois (P0 — c'est le bilan)

Pas un écran à part : le score **est** le total du bilan (§3.a). Décomposition visible (points de lecture,
malus achats, et plus tard bonus objectif), historique des mois précédents. Entièrement dérivé du journal de
lecture et des achats — aucune saisie spécifique.

### 6. Objectif du mois (P1)

Le seul vrai morceau repoussé.
- Un objectif par mois : une cible chiffrée par catégorie (0 = catégorie non visée).
- Jauge de progression par catégorie + état global (atteint / pas encore).
- Modifiable tant que le mois est en cours.
- Bonus **+3** all-or-nothing, qui vient s'ajouter au total du bilan.

## Stack

Identique à BoxBox — on sait qu'elle marche.

| Couche | Tech |
|---|---|
| Front | Next.js 16 (App Router) + Tailwind 4 |
| Back | Server Actions + Route Handlers |
| Base | PostgreSQL via Supabase |
| Auth | Supabase Auth |
| Métadonnées VO (comics) | **Metron** — UPC + `series_type` (Basic Auth, côté serveur) |
| Métadonnées VF (BD, manga, roman) | Google Books API (primaire) + Open Library (fallback) |
| Scan | BarcodeDetector API + ZXing (seul à décoder le supplément 5 chiffres des issues) |
| Hébergement | Vercel |
| Tests | Vitest (logique de scoring) |

Le **calcul du score vit en TypeScript** (`lib/scoring/`), pas en SQL : la base ne stocke que des faits
(lectures, achats, objectifs), le score est dérivé. Testable au Vitest, modifiable sans migration.

## Modèle de données (esquisse)

- `profiles` — un par utilisateur.
- `books` — le bouquin en tant qu'objet : titre, série, numéro, auteurs, éditeur, pages, couverture, ISBN,
  **`barcode_raw` (UPC 12 + supplément 5, tel que scanné)**, `category`, provenance (scan / manuel), source des
  métadonnées (metron / google_books / manuel) + identifiant chez la source.
- `readings` — une lecture : `book_id`, `status` (`reading` | `finished`), `started_at`, `finished_at`.
- `purchases` — un achat : `book_id`, `purchased_at`.
- `monthly_objectives` + `objective_targets` — l'objectif du mois et ses cibles par catégorie.

RLS activée partout, `user_id` sur chaque table.

## TBD

- **Abandon d'une lecture** : est-ce un état à part (`abandoned`, 0 point) ou on supprime la ligne ?
- **Bonus objectif** : confirmé all-or-nothing (+3 si toutes les cibles sont atteintes) — à retester à l'usage,
  l'alternative étant +3 par catégorie remplie.
- **Frontière comics / omnibus** : le seuil de pages est arbitraire, à caler sur des vrais bouquins.
- Mode multi (Prem vs Léna) : comparaison mensuelle + « meilleur paliste du mois » (+5).
- Notifications (rappel de fin de mois, objectif presque atteint).

## Backlog (gardé en tête, pas construit maintenant)

- **Import rétroactif** : ressaisir les lectures des mois déjà passés à l'antenne pour avoir des courbes
  historiques. Écarté au lancement (on démarre à zéro), mais le modèle de données doit rester compatible :
  dates de lecture toujours libres, jamais figées à la date de saisie.
- **Instance Metron auto-hébergée** : leur code est en GPL, leurs données en CC BY-SA — possible si le volume
  d'appels dépasse leur usage « personnel normal ».

### Le dump GCD — trajectoire assumée, pas un « peut-être »

Importer la base `barcode → issue` de la **Grand Comics Database** dans Supabase est la **direction prévue à
terme**. On ne le fait pas maintenant (une journée d'ETL + un refresh mensuel du dump, avant même d'avoir scanné
le premier bouquin), mais on construit en sachant qu'on ira.

Pourquoi c'est la bonne fin de partie :

- **Ça rend le scan dégradé utile.** Le filtre `?upc=` de Metron est un **match exact** : avec seulement les 12
  chiffres (supplément raté — le cas le plus fréquent), il ne peut rien répondre. Une table locale, elle, retrouve
  le **titre par préfixe** : il ne reste qu'à demander le numéro. C'est l'argument décisif, plus encore que le quota.
- Pas de quota, pas de dépendance réseau, réponse instantanée.
- Meilleure couverture des vieux fascicules et de l'indé.
- Licence saine pour commercialiser (CC BY-SA 4.0 + attribution).

**Déclencheurs** : Metron rate trop de scans, ou les quotas / CGU deviennent contraignants, **ou on
commercialise** — le compte de service Metron unique ne tient pas la charge d'une base d'utilisateurs, et sort
du cadre de leurs CGU.

**Le pont est déjà construit** : `barcode_raw` stocké sur chaque livre + cache local de chaque résolution → le
jour de la bascule, on rejoue tout l'historique, aucun bouquin n'est re-scanné.
