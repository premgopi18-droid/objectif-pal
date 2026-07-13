# Objectif PAL — Specs produit

> **Source de vérité du produit.** Toute décision prise en conversation atterrit ici.
> Dernière révision : 13/07/2026 — document réécrit à plat après arbitrage des sources de métadonnées.

---

## 1. Le produit

PWA mobile-first adossée à l'émission **Objectif PAL** (Prem & Léna), dont le sujet est la réduction de la PAL
(pile à lire).

**Objectif principal : répertorier mes lectures et en tirer des statistiques**, assez propres pour que je puisse
**donner mes chiffres à Léna pour l'émission**. Tout le reste est au service de ça.

Le geste central : je commence un livre → je scanne son code-barres → il entre dans mes lectures, classé dans la
bonne catégorie. À la fin du mois, l'app me sort le bilan que je lis à l'antenne.

- Langue UI : **français**. Langue du code : **anglais**.
- **Solo au lancement**, mais **modèle de données multi-utilisateur dès le départ** (`user_id` partout, RLS
  activée) : brancher la comparaison Prem vs Léna plus tard ne doit demander aucune migration douloureuse.
  Horizon connu : **4-5 utilisateurs**.

### La vision, à terme

> **« Cette app sera le reflet de notre bibliothèque, de notre PAL et de nos stats de lecteurs — clairement,
> notre vie en tant que lecteurs. »**

Ce n'est pas une phrase de brochure : elle **contraint la conception**, et voici comment.

**1. Les données doivent survivre à l'app.** Dans cinq ans, le journal contiendra des années de lecture — il
devient irremplaçable, et le lock-in devient inacceptable. D'où l'export (§4.8) et la portabilité (§10), qui ne
sont pas du confort mais une **exigence de premier rang**. Corollaire : **rien n'est jamais supprimé en dur**.
Un livre retiré, une lecture effacée : on **marque**, on ne détruit pas.

**2. Le journal doit survivre au barème.** Le barème est une règle de jeu de l'émission — il changera peut-être.
Les lectures, elles, sont des **faits**, et ne doivent jamais être polluées par la façon dont on les compte.
C'est pour ça que **le score est toujours dérivé** et qu'aucune colonne `points` n'existe en base : le jour où le
barème change, **des années de lectures restent intactes**.

**3. Il manquera la possession.** On modélise « ce que j'achète » et « ce que je lis ». Une bibliothèque, c'est
plus large :

| Cas | Aujourd'hui |
|---|---|
| Posséder sans avoir lu | ✅ la PAL (`purchases` sans `readings`) |
| Avoir lu sans posséder (emprunt, médiathèque) | ✅ une lecture sans achat |
| **Posséder sans avoir acheté dans l'app** (les étagères d'avant) | ❌ **manquant** |

Ce dernier cas, c'est **l'essentiel d'une vraie biblio**. Il faudra une action « **je possède** » — scanner une
étagère entière **sans que ça compte comme un achat du mois** (pas de −1, sinon le score plonge à −80). C'est du
**backlog, pas du MVP**, et ça se rajoutera en une migration : **une table de plus, un bouton de plus.** Rien à
réécrire, parce que `books` existe **indépendamment** de ce qu'on fait du livre.

> **La seule précaution à prendre dès maintenant, et elle est gratuite — une question de vocabulaire.**
> La PAL, c'est **« ce que je possède et que je n'ai pas lu »**. Aujourd'hui on la calcule à partir des
> **achats**, faute de mieux. Le jour où la possession existera, **la définition ne changera pas** — seule la
> source s'élargira. Si on écrivait partout « la PAL = les achats non lus », il faudrait corriger **la stat
> centrale de l'émission dans six écrans**.

### Priorités

| Rang | Bloc | Pourquoi |
|---|---|---|
| **P0** | **Journal de lecture** (scan, catégorie, états, dates) + **achats** + **bilan mensuel au barème** + analyses | C'est le produit. Le bilan est le livrable ; le score n'est qu'une multiplication du décompte, il vient gratuitement avec. |
| **P1** | **Objectifs mensuels** (cible par catégorie, jauge, bonus +3) | Le jeu de l'émission. Ne sert à rien sans données : on le branche quand P0 tourne. |
| **P2** | **Compétition** Prem vs Léna (comparaison mensuelle, « meilleur paliste » +5) | Plus tard. Le modèle de données est prêt à l'accueillir. |

**Conséquence : la saisie doit être irréprochable avant tout le reste.** Une stat ne vaut que ce que vaut le
journal. Scanner, classer et dater un bouquin doit être rapide et sans friction — c'est là qu'on met l'effort.

---

## 2. Catégories

Six catégories, exclusives. C'est la catégorie qui détermine les points.

| Catégorie | Code | Ce que c'est |
|---|---|---|
| Issue | `issue` | Un fascicule VO à l'unité (~20-30 p., pas d'ISBN, code-barres UPC-A) |
| Manga | `manga` | Un tome de manga |
| BD | `bd` | Un album franco-belge |
| Comics | `comics` | Un recueil VO (TPB) compilant plusieurs issues |
| Omnibus | `omnibus` | Un gros volume compilant plusieurs tomes ou arcs |
| Roman | `roman` | Un roman (texte, sans images) |

---

## 3. Barème

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
| _Meilleur paliste du mois_ | _+5 — **parqué**, arrivera avec le mode multi (P2)_ |

> Le barème vit dans **une constante unique** (`lib/scoring/scale.ts`). Jamais recopié en dur ailleurs.

### Règles de calcul

1. **Les points sont crédités à la date de fin de lecture.** Un bouquin commencé en mars et terminé en avril
   rapporte ses points **en avril**. Commencer une lecture ne rapporte rien — c'est ce qui empêche de gonfler
   son score en ouvrant dix bouquins.
2. **Une lecture abandonnée rapporte 0 point.** Si elle est reprise et terminée plus tard, elle rapporte
   normalement, à sa date de fin.
3. **Malus achat : −1 immédiat, effaçable.** Tout livre acheté dans le mois retire 1 point dès l'enregistrement
   de l'achat. S'il est **terminé avant la fin du même mois**, le malus est annulé (et les points de lecture
   s'ajoutent normalement). À la clôture, il reste donc **−1 par livre acheté ce mois-là et non terminé**.
   - Acheté en mars, terminé en avril : le −1 de mars **reste acquis** (le mois est clos), et les points de
     lecture tombent en avril.
4. **Objectif mensuel = un nombre de bouquins par catégorie.** Ex. « 3 mangas + 1 BD + 2 issues ». Le bonus
   **+3 est all-or-nothing** : toutes les cibles déclarées doivent être atteintes. Seules les lectures
   **terminées dans le mois** comptent.
5. **Score du mois** = points des lectures terminées dans le mois − achats du mois non terminés à la clôture
   + 3 si l'objectif est atteint.
6. **Les demi-points existent** (issue = 0,5) → le score est un **décimal**, jamais un entier. Tous les points
   sont des multiples de 0,5, donc exactement représentables en flottant : pas de piège d'arrondi.

---

## 4. Fonctionnalités

### 4.1 Scanner un bouquin (P0)

Détaillé en §5. En deux mots : un seul bouton, la caméra, et l'app se débrouille — le code-barres dit lui-même
s'il s'agit d'un ISBN ou d'un fascicule VO.

La **catégorie est proposée automatiquement** et reste **corrigeable en un tap**. La correction de l'utilisateur
fait foi, toujours.

#### L'intention du scan : « je commence » ou « j'achète » ?

Un scan ne veut pas dire la même chose selon le moment — et les deux gestes n'ont **pas le même effet sur le
score**. Donc **l'app demande**, une fois le livre résolu : deux gros boutons.

| Bouton | Effet |
|---|---|
| **Je commence** | Crée une **lecture** (`reading`, `started_at` = aujourd'hui, modifiable). 0 point pour l'instant. |
| **Je l'achète** | Crée un **achat** (`purchased_at` = aujourd'hui). **−1 point** immédiat, effaçable si terminé dans le mois. |

Explicite, impossible de se tromper, et ça couvre le cas réel : acheter trois bouquins en librairie sans en
commencer aucun. Deviner à la place de l'utilisateur fausserait **la stat la plus importante de l'émission** (la
santé de la PAL).

Un livre acheté puis commencé plus tard : on rescanne, ou on le sort de la PAL en un tap — l'achat et la lecture
pointent le **même `book_id`**.

> **Ce choix n'est pas qu'ergonomique, c'est le découpage de l'app.**
> **Le scan ne fait qu'une chose : résoudre un livre.** Ce qu'on en fait est une **action**, choisie après.
> Aujourd'hui il y en a deux ; demain la **wishlist** (scanner en librairie ce qu'on ne prend pas), les
> **favoris**, « je l'ai revendu »… **ne seront qu'un bouton de plus sur la même feuille** — aucune refonte,
> parce que résolution et intention sont déjà séparées.
> Si le scan signifiait « commencer une lecture », l'intention serait **codée en dur dedans**, et chaque nouvelle
> action demanderait de tout redécouper.
>
> **Règle qui va avec : une table par action** (`readings`, `purchases`, puis `wishlist_items`, `favorites`) —
> **pas** de table `events` générique. Plus verbeux, mais chaque action a ses propres champs (une lecture a des
> dates, un achat aura un prix, une wishlist une priorité) et une table fourre-tout finit toujours en sac de
> nœuds.

#### Terminer une lecture

C'est **le geste qui rapporte les points**, il doit être trivial : depuis la liste des lectures en cours, **un
tap** → `finished`, avec `finished_at` **pré-rempli à aujourd'hui mais modifiable** (on finit souvent un livre le
soir et on le déclare le lendemain).

### 4.2 Mes lectures — le journal (P0)

La liste de tout ce que je lis et ai lu :

- l'**état** : `reading` / `finished` / `abandoned` ;
- la **date de début** et la **date de fin** ;
- la catégorie, la série, le numéro de tome ;
- filtres par état, catégorie, série, mois.

Une lecture est une **entrée distincte du livre** : relire un bouquin crée une **nouvelle lecture** (et rapporte
à nouveau ses points), **sans créer un second livre**.

> **Règle d'unicité — un livre par code-barres et par utilisateur.** Rescanner un bouquin déjà connu ne crée
> **jamais** une deuxième entrée `books` : on réutilise l'existante (contrainte d'unicité sur
> `(user_id, barcode_raw)`). Sans cette règle, une relecture ou un double scan **dédoublerait silencieusement**
> la bibliothèque et fausserait toutes les stats par série et par éditeur.
> L'app doit d'ailleurs le **dire** : « tu l'as déjà — tu le relis ? »

**L'abandon est un état à part entière, et il est réversible.** Une lecture abandonnée n'est **jamais
supprimée** : elle garde sa date de début, passe en `abandoned`, et rapporte 0 point.

| Transition | Effet |
|---|---|
| `reading` → `abandoned` | 0 point. |
| `abandoned` → `reading` | **Reprise** : la lecture repart. |
| `reading` ou `abandoned` → `finished` | Points crédités à `finished_at`. |

**Chaque changement d'état écrit une ligne datée dans un journal en append-only** (`reading_events`), et **rien
n'est jamais effacé**. C'est la seule façon de tenir la promesse des stats : si la reprise effaçait la date
d'abandon, **on effacerait la preuve qu'il y a eu abandon** — et le « nombre de reprises » vaudrait
éternellement zéro.

Ce journal permet aussi les **cycles multiples** (lâcher un bouquin deux fois avant de le finir, ça arrive) et
donc de raconter : *« celui-là, je l'ai abandonné deux fois avant d'en venir à bout »*.

Deux stats en sortent : **le nombre d'abandons** et **le nombre de reprises** (les bouquins finis après avoir
été lâchés).

**Complétude avant tout** : il doit toujours être possible d'**ajouter une lecture à la main** (bouquin non
scannable) et de **corriger les dates après coup**.

**On démarre le journal à zéro** : pas de reprise des lectures antérieures à l'app (cf. backlog). Corollaire pour
le modèle de données : **aucune date n'est jamais forcée à « maintenant »** — `started_at` et `finished_at` sont
toujours librement saisissables, sinon l'import rétroactif deviendra impossible.

### 4.3 Statistiques & analyses (P0)

#### Le bilan du mois au barème — **l'écran principal, le livrable**

C'est **exactement ce que je donne à Léna**. Rien d'autre n'a cette priorité.

| Ligne | Contenu |
|---|---|
| Une ligne par catégorie | Nombre de bouquins **terminés** dans le mois |
| Achats non lus | Nombre de livres **achetés dans le mois et pas terminés** (le malus) |
| Total | Le score du mois, dérivé des lignes ci-dessus |

Les points ne sont qu'une multiplication de ces comptes par le barème : **le bilan et le score sont le même
écran.** Il doit être **copiable en un tap** (texte propre, lisible tel quel à l'antenne) et consultable pour
**n'importe quel mois passé**.

#### Les analyses (second rideau)

**Santé de la PAL** — *la stat centrale de l'émission*
- Entrées vs sorties : achats du mois contre lectures terminées du mois.
- **Solde de PAL** : elle fond ou elle grossit ? Courbe cumulée dans le temps.
- Taille de la PAL à date (possédés non lus).
- **Lectures hors PAL** : ce que j'ai lu sans le posséder (emprunts, médiathèque).

> **⚠️ Deux dénominateurs différents, à ne jamais confondre.**
> Un livre **lu mais non possédé** (emprunté à un pote, pris à la médiathèque) **compte pour les points, le
> volume et le rythme** — le barème récompense le fait de **finir** un bouquin, pas de le posséder.
> **Mais il ne compte PAS comme une sortie de PAL** : il n'y a jamais été. Le compter ferait dire à la courbe
> qu'on vide sa pile alors qu'elle n'a pas bougé — **on mentirait à l'antenne**.
>
> | Stat | Périmètre |
> |---|---|
> | Points, volume, rythme | **Toutes** les lectures |
> | Santé de la PAL (solde, courbe) | **Uniquement** les lectures de livres possédés |
>
> **Implémentation aujourd'hui** : « possédé » = le livre a un `purchase`. Quand l'action « je possède »
> arrivera (§12), la source s'élargira **sans changer la définition** — c'est tout l'objet de la précaution de
> vocabulaire du §1.
>
> Bénéfice : ça fait apparaître **« combien je lis en dehors de ma pile »** — précisément le comportement qui
> fait grossir une PAL au lieu de la vider.

**Volume**
- Lectures terminées : ce mois-ci, cette année, au total — et le détail par catégorie.
- Pages lues (via le nombre de pages des métadonnées).
- Moyenne par mois, meilleur mois.

**Rythme**
- Durée moyenne d'une lecture (`finished_at − started_at`), par catégorie.
- Lectures en cours et depuis combien de temps (celles qui traînent).
- Abandons et reprises.

**Répartition**
- Par catégorie, par éditeur, par série.
- Séries en cours : combien de tomes lus, quel est le suivant.

### 4.4 Achats (P0)

Enregistrer un achat (scan ou saisie) avec sa date. Il sert deux fois :
- il alimente la **PAL** (« acheté pas lu »), le solde entrées/sorties et **la ligne « achats non lus » du
  bilan** ;
- il déclenche le **malus −1**.

Un achat se « convertit » en lecture quand on commence le livre.

### 4.5 Score du mois (P0 — c'est le bilan)

Pas un écran à part : le score **est** le total du bilan. Décomposition visible (points de lecture, malus achats,
et plus tard bonus objectif) + historique des mois précédents. **Entièrement dérivé** du journal et des achats :
aucune saisie spécifique, aucun stockage de score.

### 4.6 Authentification (P0)

**Connexion Google (OAuth), via Supabase Auth.** Un bouton, un tap, pas de mot de passe à retenir.

> **Piège vécu sur BoxBox, à ne pas remanger** : si l'URL de redirection est figée dans une variable
> d'environnement (`NEXT_PUBLIC_SITE_URL`), **le login depuis une preview renvoie sur la prod**. Il faut
> construire le `redirectTo` à partir de l'**origine réelle de la requête**, pas d'une constante — sinon on ne
> peut plus tester un flux authentifié ailleurs qu'en production.

### 4.7 L'app est une PWA (P0)

Ce n'est pas cosmétique : sans ça, pas d'icône sur l'écran d'accueil et un accès caméra bancal.

- `manifest.json` (nom, icônes, `display: standalone`, thème).
- Service worker minimal (coquille applicative en cache — **pas** de synchronisation hors ligne au lancement,
  cf. TBD).
- Icônes et splash, `theme-color`.
- HTTPS obligatoire pour la caméra — fourni par l'hébergeur.

### 4.8 Export de mes données (P0)

Un bouton « exporter » qui sort **tout** : livres, lectures, achats, objectifs, en **JSON et CSV**.

Deux raisons, et la seconde est la vraie :
1. Sortir des chiffres pour l'émission dans un tableur si l'envie prend.
2. **Ne jamais être prisonnier de l'app.** Mes données sont à moi et je peux partir avec — c'est la même
   exigence que la portabilité de l'infra (§10).

### 4.9 Objectif du mois (P1)

- Un objectif par mois : une **cible chiffrée par catégorie** (0 = catégorie non visée).
- Jauge de progression par catégorie + état global.
- Modifiable tant que le mois est en cours.
- Bonus **+3 all-or-nothing**, ajouté au total du bilan.

---

## 5. Le scan — architecture

### 5.1 Un seul point d'entrée : le code se route lui-même

Pas de parcours séparés (« je scanne un comic » / « je scanne une BD ») : **les premiers chiffres du code disent
ce que c'est.**

| Code scanné | Ce que c'est | Où on cherche |
|---|---|---|
| EAN-13 préfixé **978 / 979** | Un **ISBN** — BD, manga, roman, **et les TPB / omnibus VO** | GCD (par ISBN) → Google Books → Open Library |
| **UPC-A** 12 chiffres (tout le reste) | Un **fascicule VO** | GCD (code exact, sinon **par préfixe**) |

**Le supplément de 5 chiffres n'a pas le même sens selon le support** — piège classique :

| Support | Code | Sens des 5 chiffres |
|---|---|---|
| Fascicule (issue) | UPC-A 12 + 5 | **numéro d'issue, couverture, tirage** → on le garde |
| TPB / omnibus / roman | EAN-13 (`978…`) + 5 | **le prix** (`51095` = 10,95 $) → on le jette |

### 5.2 La cascade de résolution

```
GCD (identifie, les deux types)
  → Google Books (la VF : BD, manga, roman)
    → Open Library (filet)
      → Metron (enrichit : couverture + series_type)
        → saisie manuelle (le filet ultime, toujours disponible)
```

**Décision, prise sur mesures (§6) : GCD identifie, Metron habille.**

- **GCD, importé chez nous** (table réduite, ~56 Mo) → **identifier** : match exact sur le code complet, **et
  recherche par préfixe** quand le scan rate le supplément. Aucun quota, aucune latence réseau, indé couvert.
- **Google Books / Open Library** → la **VF**, que GCD ignore par nature (BD franco-belge, manga français,
  romans).
- **Metron** (API) → **enrichir** : la **couverture** et le `series_type`, qui donne la catégorie du barème
  proprement.

**Contrainte d'architecture** : la résolution vit derrière une **interface de providers**
(`resolveByBarcode`, `resolveByIsbn`), implémentations interchangeables essayées en cascade. Changer ou ajouter
une source = un branchement, pas une réécriture.

Ni **League of Comic Geeks** (aucune API publique) ni **CLZ** (base propriétaire) ne sont exploitables : tous deux
maintiennent leur propre base — ils font exactement ce qu'on fait ici.

### 5.3 Ce que le scan capte, et ce que l'app en fait

Dégradation douce : **jamais d'échec sec**.

| Ce que le scan capte | Ce que fait l'app |
|---|---|
| Code complet (UPC + supplément) | **Issue exacte, zéro question** |
| 12 chiffres, préfixe net (**81,7 %** des cas) | Série connue → *« quel numéro ? »*, **un tap** (liste des numéros de la série, pas de clavier) |
| 12 chiffres, préfixe partagé (18,3 %) | **Liste courte** des séries possibles → **deux taps** |
| ISBN | Résolution directe (GCD, puis Google Books) |
| Rien / inconnu | **Saisie manuelle** série + numéro, série **mémorisée** (la 2ᵉ issue prend 3 secondes) |

Rappel technique : **`BarcodeDetector` natif ne renvoie pas le supplément de 5 chiffres.** Seul **ZXing** sait le
décoder, et seulement s'il est net et cadré. On ne peut donc jamais compter dessus — d'où cette cascade.

### 5.4 Les couvertures — la photo est la vraie réponse

**Constat vérifié : il n'existe aucune source de couvertures VO à la fois gratuite, fiable et utilisable
commercialement.** C'est logique — une couverture est une **œuvre sous copyright de l'éditeur**.

| Source | Verdict |
|---|---|
| **Comic Vine** | La plus grosse base d'images, indé compris — mais **usage commercial explicitement interdit** (clé révoquée), 200 req/h. |
| **GCD** | Les scans existent sur le site mais **pas dans le dump** (vérifié : aucune table `cover`). Hotlinker = fragile et discourtois. |
| **Google Books / Open Library** | Couvertures **par ISBN seulement** → parfait pour BD, manga, roman, TPB, omnibus. **Inutile pour les fascicules.** |
| **Marvel API** | Gratuite et officielle, mais **Marvel uniquement** → ne résout pas l'indé. |
| **Metron** | Héberge des couvertures, gratuit — mais CGU « usage personnel », même limite qu'ailleurs. |

**Décision : cascade automatique, puis la photo.**

1. **Tentative automatique** : Metron (VO) puis Google Books (VF) → couvre la majorité des lectures sans rien
   demander.
2. **Sinon, l'app propose de photographier la couverture** — la caméra est **déjà ouverte** pour le scan et le
   livre est **déjà dans la main**. Un tap.

Ce n'est pas un pis-aller, c'est meilleur qu'une API : **100 % de couverture** (y compris le Kickstarter tiré à
500 exemplaires), **zéro risque juridique même en commercialisant** (chacun photographie *sa* pile, aucune
redistribution), **zéro quota**, et c'est **l'exemplaire réel** avec sa vraie variante.

**Stockage** : Supabase Storage, **1 Go gratuit**. Compression **WebP côté client** (~150 Ko/couverture) →
**~6 000 bouquins**. Hors d'atteinte.

### 5.5 Deviner la catégorie du barème

La catégorie est **proposée**, jamais imposée. Ordre des signaux, du plus fiable au moins fiable :

| Signal | Catégorie proposée |
|---|---|
| `series_type` Metron = Single Issue / One-Shot / Annual | `issue` |
| `series_type` Metron = Trade Paperback / Hardcover / Graphic Novel | `comics` |
| `series_type` Metron = Omnibus | `omnibus` |
| Code **UPC-A** (donc fascicule VO) sans autre signal | `issue` |
| Langue `ja` ou éditeur manga FR (Glénat, Kana, Pika, Kurokawa, Ki-oon, Tonkam…), ~180-220 p. | `manga` |
| Éditeur franco-belge (Dargaud, Dupuis, Le Lombard, Casterman, Delcourt…), ~46-72 p. | `bd` |
| Éditeur comics VF (Panini, Urban Comics…) | `comics` |
| Aucun signal illustré, catégorie Google Books « Fiction » / « Literary » | `roman` |

**Point faible connu et assumé** : pour la **VF**, on n'a que des indices (éditeur, pages, langue). Ça se
trompera parfois. **C'est pour ça que la correction en un tap n'est pas une option mais une exigence.**

---

## 6. Les données GCD — mesuré, pas supposé

Mesures réelles sur le dump du **2026-07-01** (3,76 Go), via `scripts/gcd-inspect.mjs` et
`scripts/gcd-barcodes.mjs`, qui lisent le dump **en flux** sans jamais le charger en mémoire.

| Mesure | Valeur |
|---|---|
| Issues au total | 2 585 543 |
| Séries / éditeurs | 231 107 / 17 619 |
| **Issues avec un code-barres** | **423 907** |
| Issues avec un ISBN | 231 792 |
| **Poids de la table réduite, index compris** | **~56 Mo** (1/9 du plafond gratuit Supabase) |

**1. Le supplément est présent dans 67 % des codes stockés** (17-18 chiffres). Donc GCD connaît les codes
complets → une **recherche par préfixe sur les 12 premiers chiffres** retrouve la série même quand le scan rate
le supplément. **C'est ce que l'API Metron ne sait pas faire** (son filtre `?upc=` est un match exact).

**2. L'indé est massivement couvert.** Marvel (95 288) et DC (74 119) ne pèsent que **40 %** des issues
code-barrées. Le reste : Image (20 850), IDW (18 543), Dynamite (18 201), Boom! (12 896), Dark Horse (11 984),
Titan, Zenescope, Valiant, Avatar Press, Action Lab… **6 issues sur 10 ne sont ni Marvel ni DC.**

**3. La base est vivante** : 15 000 à 20 000 issues indexées par an depuis 2015, dont déjà 8 614 pour 2026.

**4. Le préfixe UPC-A identifie bien la série.** Sur 41 425 préfixes distincts : **93,9 % ne pointent que vers
une seule série** (81,7 % si on raisonne en issues). Les 6 % ambigus sont **structurels** — les éditeurs
recyclent un code fourre-tout pour les promos, le Free Comic Book Day, les one-shots (`Rick and Morty
Presents: …` = 22 séries sous un code), les collections scolaires. **Les séries régulières ont un préfixe
propre.**

### Import et rafraîchissement

- **Source** : le dump sur [comics.org/download](https://www.comics.org/download/) — **MySQL compressé**,
  régénéré **toutes les 2 semaines**, **compte gratuit requis**. Pas d'API, donc **pas de quota**.
- **Téléchargement** : `scripts/gcd-download.mjs` — rejoue le **cookie de session** d'un compte comics.org
  (`GCD_SESSION_COOKIE`), lit la page et y **cherche le lien du `.zip`** (donc résistant à un renommage).
- **Export** : `scripts/gcd-export.mjs` → `data/gcd_issues.csv` (425 077 lignes, 30 Mo) et `data/gcd_series.csv`
  (73 116 séries, 3,7 Mo). `data/` est **gitignoré** (régénérable en ~3 min).
- **Chargement** : `COPY` vers Supabase, **dans une transaction** : on vide et on recharge `gcd_issues` d'un
  bloc. C'est une **table jetable**, entièrement reconstructible depuis le dump.

### Le rafraîchissement n'est pas un problème — et voici pourquoi

**On n'aura presque jamais besoin de le refaire.** Ce qui manque dans une base GCD vieille de trois mois, ce sont
les **nouveautés** — ~1 500 issues par mois. Or les nouveautés, c'est exactement ce que **Metron** couvre le mieux
(il est alimenté chaque semaine sur les sorties).

**Donc la base se complète toute seule à l'usage :**

| Source | Rôle |
|---|---|
| **GCD** (import massif) | Le **fonds historique** : 425 000 issues, l'indé, le rétro |
| **Metron** (à la demande) | Les **nouveautés** que GCD n'a pas encore, résolues au moment du scan |
| **Notre cache** | Chaque résolution réussie **enrichit notre base pour toujours** |

Le rafraîchissement du dump devient un **confort, pas une nécessité** : **trimestriel suffit**.

> **⚠️ Conséquence structurelle : deux tables, jamais une seule.**
> `gcd_issues` est un **pur import**, écrasé à chaque refresh. Notre **cache de résolutions** (les comics
> découverts via Metron) est une **table séparée, jamais écrasée**. Si on écrivait les résolutions Metron dans
> `gcd_issues`, **chaque rafraîchissement les détruirait** — et on perdrait du terrain à chaque fois qu'on croit
> en gagner.

**Automatisation** : une **commande locale** (`npm run gcd:refresh`), lancée quand ça arrange. Pas de GitHub
Action : monter une CI pour un job qu'on fait **quatre fois par an**, avec un cookie de session qui **expirera**,
c'est de l'ingénierie pour l'ingénierie — et une CI cassée est plus pénible qu'un clic trimestriel.

### Licence — obligation, pas option

Données **GCD** et **Metron** en **CC BY-SA 4.0** → l'app **doit créditer les deux bases** (mention visible +
lien). Commercialisation possible à cette condition.

---

## 7. Modèle de données

RLS activée **partout**, `user_id` sur **chaque** table utilisateur.

> **⚠️ Toutes les dates de lecture et d'achat sont des `date`, jamais des `timestamptz`.**
> Le bilan est **mensuel**. Avec un timestamp, une lecture terminée le **31 juillet à 23 h** en France bascule
> **en août** une fois convertie en UTC — le bilan qu'on lit à l'antenne serait faux d'un ou deux bouquins, et
> personne ne comprendrait pourquoi. Une lecture se termine **un jour**, pas à un instant : `date` est le bon
> type, et il supprime la classe de bugs entière.

### Tables utilisateur

**`profiles`** — un par utilisateur (`id` = `auth.users.id`, `display_name`).

**`books`** — le bouquin en tant qu'objet, tel que l'utilisateur l'a enregistré.

| Colonne | Rôle |
|---|---|
| `user_id` | RLS |
| `title`, `series_name`, `issue_number`, `authors`, `publisher`, `page_count` | Métadonnées d'affichage |
| `category` | **enum** : `issue` / `manga` / `bd` / `comics` / `omnibus` / `roman` |
| `barcode_raw` | Le code **tel que scanné**, supplément inclus |
| `barcode_type` | `isbn` / `upc` |
| `barcode_prefix` | Les 12 premiers chiffres — **indexé** |
| `isbn` | Si applicable |
| `cover_url` | Couverture distante (Metron / Google Books) **ou** chemin Supabase Storage si photo |
| `metadata_source` | `gcd` / `google_books` / `open_library` / `metron` / `manual` |
| `metadata_source_id` | L'identifiant chez la source (dont le **`gcd_id`**) — permet de re-résoudre plus tard |

**Contrainte d'unicité : `(user_id, barcode_raw)`.** Un rescan réutilise le livre existant, il n'en crée jamais
un second (cf. §4.2).

> **Pourquoi stocker `barcode_raw` et `barcode_prefix` :** si on change de source demain, on **re-résout tout
> l'historique sans re-scanner un seul bouquin**. C'est le pont qui rend toute décision de source réversible.
>
> **Pourquoi stocker le `gcd_id`** : c'est le filtre le plus précis pour aller chercher **la bonne couverture**
> chez Metron (`?gcd_id=`) — bien plus fiable qu'une recherche par titre, qui confond les variantes de couverture.

**`readings`** — une lecture.

| Colonne | Rôle |
|---|---|
| `user_id`, `book_id` | |
| `status` | **enum** : `reading` / `finished` / `abandoned` — l'état **courant** |
| `started_at` | date, **librement saisissable** |
| `finished_at` | date, nullable — **c'est elle qui date les points** |

**`reading_events`** — le **journal d'états, en append-only** : `reading_id`, `status`, `occurred_at`. Une ligne
à chaque changement, **jamais d'effacement**. C'est lui qui permet de compter les **abandons** et les
**reprises**, et de supporter plusieurs cycles sur un même bouquin. `readings.status` n'est que le **dernier
état connu** — une commodité de lecture, pas la vérité historique.

**`purchases`** — un achat : `user_id`, `book_id`, `purchased_at` (date).

**`monthly_objectives`** (P1) — `user_id`, `month` (1er du mois).
**`objective_targets`** (P1) — `objective_id`, `category`, `target_count`.

### Tables de référence (GCD, en lecture seule)

**`gcd_issues`** — **`gcd_id`**, `barcode` *(indexé)*, `barcode_prefix` *(indexé)*, `series_id`, `number`,
`page_count`, `key_date`, `isbn`, `title`. 425 077 lignes.

**`gcd_series`** — `id`, `name`, `format`, `year_began`, `publisher`, `language_id`. 73 116 lignes.

Ces deux tables sont **jetables** : écrasées à chaque rafraîchissement du dump, entièrement reconstructibles.

**`barcode_cache`** — **notre** table, celle qui grossit toute seule : les résolutions obtenues **auprès de
Metron ou Google Books** (les nouveautés que GCD n'a pas encore). `barcode`, métadonnées normalisées, source,
`resolved_at`.

> **⚠️ Elle est séparée de `gcd_issues`, et ce n'est pas un détail** : si on écrivait les résolutions Metron dans
> la table d'import, **chaque rafraîchissement du dump les effacerait**. Séparées, la table jetable reste jetable
> et notre cache est **définitif**.

Pas de `user_id` sur ces trois tables : **données publiques**. **RLS activée quand même**, avec une politique
**lecture seule pour les utilisateurs authentifiés** et **aucune écriture depuis le client** — seul le serveur
écrit (import et cache).

### Ce qu'on ne stocke pas

**Le score.** Il est **toujours dérivé** des lectures, des achats et du barème. Aucune colonne `points`, aucune
table `scores`. Changer le barème ne demandera **aucune migration** — juste une constante et un redéploiement.

---

## 8. Fiabilité & performance

Ce qui rend cette app fiable n'est pas une optimisation exotique, c'est une poignée de choix structurels :

**Le calcul du score vit en TypeScript** (`lib/scoring/`), pas en SQL, pas en base. La base ne stocke que des
**faits** (lectures, achats, objectifs). Conséquences : testable au **Vitest** (une fonction pure, des cas
d'entrée, des points attendus), modifiable sans migration, et impossible à désynchroniser.

**Les lookups GCD sont instantanés.** 425 077 lignes, c'est petit pour Postgres. Deux index (`barcode`,
`barcode_prefix`) → une recherche en quelques millisecondes, **sans appel réseau externe**. Le scan ne dépend
d'aucune API tierce pour identifier un bouquin : Metron n'intervient qu'ensuite, pour la couverture, et **son
absence ne casse rien**.

**Toute résolution externe est mise en cache.** Un bouquin n'est jamais résolu deux fois auprès de Metron ou
Google Books. Avec 4-5 utilisateurs, on parle de quelques dizaines d'appels par mois — les quotas (20 req/min,
5 000/jour chez Metron) sont hors d'atteinte.

**Les secrets ne quittent pas le serveur.** Metron s'authentifie en **HTTP Basic Auth** (pas de clé API : les
identifiants d'un **compte de service** dédié). Ils vivent en variables d'environnement serveur, **jamais
préfixées `NEXT_PUBLIC_`**. Le client n'appelle jamais Metron : il passe par un **Route Handler**
(`/api/lookup/[barcode]`) qui interroge et renvoie un résultat normalisé.

**Le scan ne peut pas échouer.** Chaque étape a une porte de sortie, jusqu'à la saisie manuelle. L'utilisateur
n'est jamais bloqué devant un « livre introuvable ».

**Les index qui comptent** : `readings (user_id, finished_at)` et `purchases (user_id, purchased_at)` — le bilan
mensuel est une requête par mois, sur ces deux tables, et rien d'autre.

**Les images sont compressées côté client** (WebP, ~150 Ko) avant l'upload : pas de photo de 5 Mo qui plombe le
Go gratuit et la bande passante mobile.

**Mobile-first, a11y, pas de valeur magique.** Le barème dans une constante unique. Les composants réutilisables.

---

## 9. Stack

| Couche | Tech |
|---|---|
| Front | Next.js 16 (App Router) + Tailwind 4 |
| Back | Server Actions + Route Handlers |
| Base | PostgreSQL via Supabase |
| Auth | Supabase Auth — **Google OAuth** (⚠️ `redirectTo` sur l'origine réelle, cf. §4.6) |
| Stockage images | Supabase Storage (1 Go gratuit) |
| **Identification d'un scan** | **GCD importé chez nous** — table `barcode → issue`, match exact **et par préfixe** |
| Métadonnées VF | Google Books (primaire) + Open Library (fallback) |
| Enrichissement VO | Metron — **couverture** + `series_type` (Basic Auth, **côté serveur**) |
| Scan | BarcodeDetector API + **ZXing** (seul à décoder le supplément 5 chiffres) |
| Hébergement | Vercel |
| Tests | Vitest (logique de scoring) |

**Plan gratuit Supabase** : 500 Mo de base (on en utilise ~56), 1 Go de stockage, **2 projets** (BoxBox +
celui-ci), pause après 7 jours d'inactivité (sans conséquence : l'app est utilisée).

---

## 10. Portabilité & coûts — pouvoir partir quand on veut

**Exigence de premier rang, au même titre qu'une feature** : on doit pouvoir **changer d'hébergeur et de base
sans réécrire l'app**. Le lock-in ne vient jamais de l'outil, il vient de ses **fonctionnalités propriétaires**.

### Interdits (chacun est un clou dans le cercueil)

| Interdit | Pourquoi | Ce qu'on fait à la place |
|---|---|---|
| **Vercel Cron** | Ne tourne que chez Vercel | **Aucun besoin** : le score et le malus se recalculent à la volée pour n'importe quel mois passé. **L'app n'a aucune tâche planifiée.** |
| **Vercel Blob / KV / Edge Config** | Stockage propriétaire | Supabase Storage (S3-compatible) et Postgres |
| Paquets **`@vercel/*`** | Adhérence directe | Rien, ou un équivalent standard |
| **Supabase Edge Functions** | Runtime Deno propriétaire | **Route Handlers Next.js** — ils tournent partout |
| Extensions Postgres exotiques | Bloquent la migration vers un autre Postgres | SQL standard |

### Ce qui garantit la sortie

- **Base** : PostgreSQL **standard**. Un `pg_dump` et on part chez Neon, Railway, ou son propre serveur. Les
  migrations sont des **fichiers SQL bruts** (`supabase/migrations/`), pas des clics dans une console.
- **Supabase est open source et auto-hébergeable** (Docker) — auth, storage et RLS compris. On peut emporter la
  stack entière.
- **Next.js tourne partout où Node tourne** : `next start`, Docker, Coolify sur un VPS, Railway, Fly. Vercel est
  un confort, pas une dépendance.
- **Stockage des couvertures derrière une interface** : Supabase Storage aujourd'hui, S3 / R2 / MinIO demain,
  sans toucher au reste.
- **Export utilisateur** (§4.8) : les données sortent de l'app en un clic.

### Coûts — tout est gratuit, avec un seul astérisque

| Poste | Coût | Plafond |
|---|---|---|
| Supabase | **0 €** | 500 Mo de base (on en utilise ~56), 1 Go de stockage, 2 projets |
| Vercel | **0 €** | Plan Hobby |
| GCD | **0 €** | Dump libre (CC BY-SA) |
| Metron | **0 €** | 20 req/min — hors d'atteinte avec le cache |
| Google Books / Open Library | **0 €** | Quota par IP |

> **⚠️ L'astérisque : le plan Vercel Hobby interdit l'usage commercial.** Le jour où l'app rapporte un euro, il
> faut passer à **Vercel Pro (20 $/mois)** ou **s'auto-héberger** (VPS + Coolify, ~5 €/mois). À savoir
> **avant** de monétiser, pas après. Rien dans le code n'empêchera cette bascule — c'est tout l'objet de cette
> section.

## 11. TBD

- **Bonus objectif** : all-or-nothing (+3 si toutes les cibles sont atteintes) — à retester à l'usage,
  l'alternative étant +3 par catégorie remplie.
- **Frontière comics / omnibus** pour la VF : le seuil de pages est arbitraire, à caler sur de vrais bouquins.
- **Fonctionnement hors ligne** : jusqu'où ? Enregistrer une lecture sans réseau et synchroniser ensuite serait
  confortable (métro, librairie) mais demande une file d'attente locale. À trancher quand le scan tournera.
- **L'affichage des stats** (graphes, mise en page, quoi met-on en avant) : à décider **en voyant les premières
  vraies données**, pas avant. Ça ne coûte rien de changer, puisque tout est **dérivé**.
  ⚠️ En revanche **ce que la base capte n'est pas rattrapable** : une donnée non enregistrée est perdue pour
  toujours. Revue faite — volume, pages, rythme, PAL, éditeurs, séries, abandons et reprises sont tous couverts
  par le schéma. **Refaire cette vérification avant d'ajouter une stat.**

## 12. Backlog — gardé en tête, pas construit

- **Import rétroactif** : ressaisir les lectures des mois déjà passés à l'antenne pour avoir des courbes
  historiques. Écarté au lancement (on démarre à zéro), mais le modèle de données **doit rester compatible** :
  dates de lecture toujours libres, jamais figées à la date de saisie.
- **« Je possède »** — l'action qui manque pour que l'app devienne vraiment le reflet de la bibliothèque (cf. la
  vision, §1) : scanner une étagère déjà là, **sans malus d'achat**. Sans elle, l'app ne connaîtra que les livres
  entrés après son installation.
- **Note et avis par lecture** *(la première chose à ajouter après le MVP)* : l'app saura **ce que** je lis,
  **quand** et **combien** — mais pas **ce que j'en ai pensé**. Or c'est la matière même de l'émission (« mes
  coups de cœur du mois », « pourquoi j'ai lâché celui-là »). Une note et un commentaire sur `readings`, ça ne
  coûte presque rien et ça transforme un tableur en **journal de lecteur**.
- **Wishlist et favoris** : scanner en librairie un bouquin qu'on ne prend pas (wishlist), marquer ses coups de
  cœur (favoris). **L'architecture les accueille déjà** — ce sera un bouton de plus sur la feuille du scan et une
  table par action. Et la wishlist nourrit la santé de la PAL : *ce que je convoite* vs *ce que j'achète* vs *ce
  que je lis*, c'est le récit complet de l'émission.
- **Mode multi** (P2) : comparaison mensuelle Prem vs Léna + « meilleur paliste du mois » (+5).
- **Notifications** : rappel de fin de mois, objectif presque atteint.
- **Instance Metron auto-hébergée** : leur code est en GPL, leurs données en CC BY-SA — une option si le volume
  d'appels dépassait un jour leur usage « personnel normal ». Peu probable : GCD fait déjà l'identification, et
  Metron ne sert qu'aux couvertures.
