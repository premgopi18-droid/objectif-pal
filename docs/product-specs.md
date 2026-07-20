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
devient irremplaçable, et le lock-in devient inacceptable. D'où l'export (§4.10) et la portabilité (§10), qui ne
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
| **Posséder sans avoir acheté dans l'app** (les étagères d'avant) | ✅ **« je possède »** (§4.13, livré le 20/07/2026) |

Ce dernier cas, c'est **l'essentiel d'une vraie biblio**. L'action « **je possède** » (§4.13) permet de scanner une
étagère entière **sans que ça compte comme un achat du mois** (pas de −1, sinon le score plonge à −80). Livré le
**20/07/2026**, et la prédiction s'est vérifiée — c'est ce qui valide la conception : **une table de plus
(`ownerships`), deux gestes de plus**, rien à réécrire. Parce que `books` existe **indépendamment** de ce qu'on
fait du livre, et parce que la règle de pile n'était écrite qu'à **un seul endroit** (`lib/pal/derive-pal.ts`).

> **La seule précaution à prendre dès maintenant, et elle est gratuite — une question de vocabulaire.**
> La PAL, c'est **« ce que je possède et que je n'ai pas lu »**. Aujourd'hui on la calcule à partir des
> **achats**, faute de mieux. Le jour où la possession existera, **la définition ne changera pas** — seule la
> source s'élargira. Si on écrivait partout « la PAL = les achats non lus », il faudrait corriger **la stat
> centrale de l'émission dans six écrans**.

### Priorités

| Rang | Bloc | Pourquoi |
|---|---|---|
| **P0** | **Journal de lecture** (scan, catégorie, états, dates) + **achats** + **note et avis** + **bilan mensuel au barème** + analyses + **auth**, **PWA**, **export** | C'est le produit. Le bilan est le livrable ; le score n'est qu'une multiplication du décompte, il vient gratuitement avec. |
| **P1** | **Objectifs mensuels** (cible par catégorie, jauge, bonus +3) + **distinctions du mois** | Le jeu de l'émission, et l'habillage éditorial du bilan. Ne servent à rien sans données : on les branche quand P0 tourne. |
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
   - **Acheté alors qu'il a déjà été terminé un mois précédent** (racheter sa propre copie d'un livre lu en
     médiathèque…) : **pas de malus** — le malus punit ce qui fait grossir la pile à lire, et un livre déjà lu
     n'y entre pas. (Décision prise à l'implémentation du moteur, 13/07/2026.)
   - **L'annulation est par livre, pas par achat** : deux exemplaires du même livre achetés le même mois, un
     seul lu → les deux malus s'annulent. Assumé (le cas est hors du geste réel) — à reconsidérer s'il se
     présente un jour.
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
> *(Décision du 19/07/2026, #35)* : la question est posée **avant** de créer la lecture, **inline sur la
> feuille d'actions** (pas un écran dédié) — le bandeau pose la question, le bouton devient « Oui, je le
> relis », « Annuler » est le non. L'info « déjà terminé » arrive avec le lookup bibliothèque (#10) : zéro
> aller-retour ajouté au geste central.

**L'abandon est un état à part entière, et il est réversible.** Une lecture abandonnée n'est **jamais
supprimée** : elle garde sa date de début, passe en `abandoned`, et rapporte 0 point.

| Transition | Effet |
|---|---|
| `reading` → `abandoned` | 0 point. |
| `abandoned` → `reading` | **Reprise** : la lecture repart. |
| `reading` ou `abandoned` → `finished` | Points crédités à `finished_at`. |
| `finished` → `reading` | **Correction d'une mauvaise manip** : la fin s'annule, `finished_at` s'efface (les points repartent avec elle), et l'événement reste journalisé comme les autres. (Ajoutée le 14/07/2026, vécue au premier test du journal.) |

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

### 4.3 Note et avis (P0 pour la donnée)

Sans ça, l'app sait **ce que** je lis, **quand** et **combien** — mais pas **ce que j'en ai pensé**. Or c'est la
matière même de l'émission.

- **Note sur 5 étoiles**, **demi-étoiles permises** (donc 0,5 → 5). Le standard Babelio / SensCritique : assez
  fin pour classer, assez grossier pour ne pas se torturer sur 200 bouquins par an.
- **Commentaire libre** — la vraie matière : *« lâché deux fois avant de m'accrocher »*, *« le dessin sauve un
  scénario mou »*.
- Les deux sont **facultatifs** et **modifiables à tout moment**. Une lecture terminée sans note reste une
  lecture valide (elle rapporte ses points normalement).

> **La donnée entre dès le jour un, l'écran peut attendre.** Une note non capturée est **perdue pour toujours** —
> personne ne se souvient dans six mois de ce qu'il pensait du tome 4. Les champs existent donc dès la première
> version, même si l'interface qui les exploite arrive plus tard.

Ce que ça ouvre côté stats : **note moyenne** (par mois, par catégorie, par série, par éditeur), **mes meilleures
séries**, **les éditeurs qui me déçoivent**, et le classement de mes lectures.

### 4.4 Les distinctions du mois (P1)

Trois choix, **à la main**, dans le bilan mensuel — parce que ce sont des **choix éditoriaux**, pas des calculs :

| Distinction | Ce que c'est |
|---|---|
| **L'œuvre préférée du mois** | Pas forcément la meilleure note : celle qui a marqué. |
| **La bonne surprise** | Ce qu'on n'attendait pas et qui a retourné. |
| **La mauvaise surprise** | La déception, l'attente trahie. |

Chacune pointe une **lecture du mois** et accepte un **commentaire**. Elles s'affichent dans le bilan, à côté des
chiffres : ce qu'on lit à l'antenne, ce n'est pas qu'un décompte.

> **Pourquoi ça ne peut pas être automatique** : une base de données ne sait pas ce qu'est une *surprise*. Une
> surprise, c'est **l'écart entre ce qu'on attendait et ce qu'on a eu** — et l'attente n'est enregistrée nulle
> part. Un chef-d'œuvre attendu comme un chef-d'œuvre n'est pas une surprise.

> **Décisions du 18/07/2026** : les distinctions **entrent dans le texte copiable** du bilan, après le score
> (ce qu'on lit à l'antenne n'est pas qu'un décompte) ; et elles restent **posables/modifiables sur un mois
> passé** (le choix éditorial se fait souvent après la clôture, en préparant l'émission). L'objectif du mois,
> lui, reste figé dès le mois clos (§4.11) : il ne change pas le jeu après coup, les distinctions si — ce sont
> des mots, pas des points.

### 4.5 Statistiques & analyses (P0)

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
> | Santé de la PAL (solde, courbe) | **Uniquement** les lectures de livres possédés — et **une sortie par livre** : sa **première** fin de lecture. Une relecture re-rapporte ses points (§4.2) mais ne re-vide pas la pile, le livre en était déjà sorti. (Décision du 14/07/2026, review de la vue PAL.) |
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

**Goûts** (à partir des notes, §4.3)
- Note moyenne : du mois, de l'année, par catégorie.
- **Mes meilleures séries**, mes meilleurs éditeurs — et ceux qui me déçoivent.
- Classement de mes lectures.

#### Découpage P0 / P1 des analyses (décision du 17/07/2026)

Le **bilan du mois au barème** (ci-dessus) est fait et reste le livrable P0 n°1. Les **analyses second rideau**
n'ont pas toutes la même urgence ni le même coût, et surtout pas la même fiabilité de données — mesuré sur le
dump GCD (559 516 issues) : **éditeur 0 % de valeurs nulles**, **pages 27,6 % nulles** (utilisable, à condition
d'afficher « sur N livres où c'est connu »), catégorie/dates/notes 100 % (l'app les tient). On construit donc
d'abord les analyses **fiables et utiles même à faible volume**, on diffère celles qui ont besoin de volume ou
d'un arbitrage.

**P0 — stats essentielles** (à construire maintenant — dérivations pures sur une base désormais typée et testée,
même patron que le moteur de score) :
- **Santé de la PAL** : solde du mois (entrées/sorties), **courbe cumulée** de la pile dans le temps, taille à
  date, lectures hors PAL. (Réutilise le cœur `derivePileStatus` de `lib/pal/derive-pal.ts` — une sortie par
  livre, deux dénominateurs, cf. l'encadré ci-dessus.)
- **Volume** : lectures terminées (mois / année / total, et par catégorie), pages lues (là où `page_count` est
  connu).
- **Répartition** : par catégorie, par éditeur.
- **Goûts** : note moyenne (globale, du mois, de l'année, par catégorie).

**P1 — analyses avancées** (différées, avec leur raison) :
- **Rythme** : durée moyenne d'une lecture, « lectures qui traînent » (demande un seuil à décider), abandons /
  reprises (dépend de la lecture de `reading_events` et du correctif `occurred_at` — cf. audit #20).

  **Correctif `occurred_at` (étape 1/3 de #30, migration `20260719180000_reading_events_occurred_at.sql`).** Le
  trigger `append_reading_event` datait chaque événement à `now()`, ce qui faussait toute saisie rétroactive.
  `occurred_at` porte désormais la date **sémantique** de la transition :
  - vers `finished` → `finished_at` (la date qui date les points, §3, toujours renseignée) ;
  - **INSERT** vers `reading` → `started_at` (un vrai début, date saisie, rétroactive permise) ;
  - **UPDATE** vers `reading` → `now()` : reprise (abandoned → reading) ou réouverture (finished → reading) ;
    `started_at` n'est pas retouché par ces gestes (il date l'ancien début), et aucune colonne ne date la
    reprise, qui se fait toujours en direct ;
  - vers `abandoned` → `now()` : pas de date d'abandon au schéma (§7), et l'abandon se fait en direct.

  L'ordre **chronologique** des transitions reste porté par la clé `id` (monotone), `occurred_at` ne servant qu'à
  ranger un événement dans son mois. La forme de `reading_events` ne change pas. Accès en lecture :
  `lib/stats/reading-events.ts` (requête filtrée `user_id` + agrégation pure abandons/reprises par mois),
  consommé depuis l'étape 2/3 par `computeStats` (`rythme.eventsByMonth`).

  **Décisions produit du 19/07/2026 (étape 2/3 de #30), livrées avec le lot A et le lot C :**
  - **« Lectures qui traînent » : seuil de 60 jours** sans être terminées (une lecture encore `reading` dont le
    début remonte à plus de 60 jours ; le seuil est strict — pile 60 jours ne traîne pas encore). Affichage en
    **liste calme** (« Commencées il y a un moment »), jamais en alerte : l'app constate, elle ne culpabilise pas.
    Constante `STALLED_READING_DAYS` (`lib/stats/compute-stats.ts`), jamais recopiée dans la vue.
  - **Classement des séries et éditeurs (goûts avancés) : minimum 3 lectures NOTÉES** pour qu'une série ou un
    éditeur soit classé — sous ce seuil, une note isolée fabriquerait une « meilleure série » mensongère. Les
    lectures non notées ne comptent pas dans le seuil. Constante `MIN_RATED_READINGS_TO_RANK`.
  - **Durée d'une lecture** : mesurable seulement si `started_at` est connu ET antérieur ou égal à `finished_at` ;
    une saisie incohérente rejoint le dénominateur « lectures non datées » plutôt que de fabriquer une durée
    négative. Une lecture commencée et finie le même jour vaut 0 jour et compte.
  - **Tomes lus par série** : on compte les **livres** distincts ayant au moins une lecture terminée — une
    relecture ne fait pas apparaître un tome de plus.
  - **Moyenne de lectures par mois** : rapportée à **tous** les mois écoulés depuis la première lecture jusqu'au
    mois de référence, **mois vides compris** (les ignorer gonflerait la moyenne). Meilleur mois : à égalité, le
    plus **ancien**.
- **Répartition par série** + séries en cours (tomes lus, tome suivant).

  **Séries en cours & tome suivant (étape 3/3 de #30, lot B — mesuré le 19/07/2026, pas supposé).** C'est le
  seul morceau des analyses qui sort du modèle pur : il faut la numérotation de la série, qui vit dans notre
  import GCD. Ce que les données permettent RÉELLEMENT :
  - le lien livre → série GCD n'existe que pour les livres résolus par **GCD** (`metadata_source = "gcd"`,
    `metadata_source_id` = le `gcd_id`). Les livres BnF, Google Books, Metron ou saisis à la main ne portent
    qu'un `series_name` en **texte** : aucun rattachement fiable, et on ne rapproche pas des noms au jugé ;
  - `gcd_issues.number` est du **texte libre** — mesure sur 12 000 lignes réparties dans l'import :
    **82,0 % de numéros purement numériques**, **11,9 % de `[nn]`** (fascicule sans numéro), **6,2 %** d'autres
    formes (« 41 (842) », « 10/2020 », « 4 Pre-Order Edition ») ;
  - notre import est **réduit** (559 516 lignes sur 2 585 543 : seulement celles qui ont un code-barres ou un
    ISBN, §6), donc le catalogue d'une série peut être **troué** — et un trou invisible ferait annoncer un
    mauvais tome. Mesure sur **356 séries françaises** : **96,1 % ont une numérotation contiguë**, 94,4 %
    commencent au tome 1, **19,1 % portent des numéros en double** (lignes de variantes du même fascicule).

  **Décisions produit (19/07/2026)** — la règle générale est qu'**un tome suivant faux serait pire que pas de
  tome suivant** :
  - **Tomes lus** : le compte déjà calculé par la répartition par série (livres distincts avec au moins une
    lecture terminée) — jamais recompté ailleurs.
  - **Tome suivant** = le **plus petit tome du catalogue non encore lu**. S'il reste un trou derrière (tomes 1
    et 3 lus), c'est bien le **2** qui est proposé : c'est le prochain à lire, pas le prochain à paraître.
  - **Les trois silences.** On n'annonce rien — et on dit pourquoi, calmement — quand : (1) la série n'a
    **aucun numéro exploitable** (que des `[nn]`, des dates…) ; (2) la numérotation connue est **trouée**, car
    on ne sait pas distinguer « le tome n'existe pas » de « le tome nous manque » ; (3) **tous les tomes lus ne
    sont pas reliés** à un numéro GCD (livre saisi à la main, résolu par la BnF, deux exemplaires d'un même
    tome) — on ignorerait alors une partie de ce qui a été lu.
  - Catalogue exploitable et tout lu → **« À jour »**, jamais « série complète » : notre import ne prétend pas
    connaître tous les tomes parus.
  - Aucune série reliée → **état vide qui explique** (« le tome suivant s'affiche pour les séries reconnues au
    scan »), plutôt qu'une section absente ou un chiffre creux.

  **Implémentation** : `lib/stats/series-catalog.ts` (requête GCD isolée + dérivation pure), consommé par
  `computeStats` → `series.inProgress`. La requête est **bornée** : au plus **5 requêtes** (les tomes lus par
  `gcd_id`, les noms de séries, puis la numérotation par paquets de 10 séries, plafond de 30 séries), jamais
  une par tome ni par série ; index couvrant `gcd_issues (series_id, number)` posé par migration — vérifié en
  *index-only scan*, 0 accès table.
- **Goûts avancés** : meilleures / pires séries et éditeurs, classement des lectures. (Bruités tant qu'il n'y a
  pas de volume.)
- Moyenne par mois, meilleur mois.

Tickets : moteur `lib/stats/` (P0), vue « Stats » (P0), analyses avancées (P1).

### 4.6 Achats (P0)

Enregistrer un achat (scan ou saisie) avec sa date. Il sert deux fois :
- il alimente la **PAL** (« acheté pas lu »), le solde entrées/sorties et **la ligne « achats non lus » du
  bilan** ;
- il déclenche le **malus −1**.

**Un achat ne se transforme jamais en lecture.** Quand on commence un livre acheté, on **crée une lecture** qui
pointe le **même `book_id`** — l'achat reste, la lecture s'ajoute. C'est ce qui permet de dire *« acheté le 3,
commencé le 17, fini le 24 »*, et de garder la PAL exacte : un livre acheté puis lu **sort** de la pile sans que
son achat disparaisse de l'historique.

Depuis la vue PAL, un tap sur un livre non lu = *« je le commence »*.

### 4.7 Score du mois (P0 — c'est le bilan)

Pas un écran à part : le score **est** le total du bilan. Décomposition visible (points de lecture, malus achats,
et plus tard bonus objectif) + historique des mois précédents. **Entièrement dérivé** du journal et des achats :
aucune saisie spécifique, aucun stockage de score.

### 4.8 Authentification (P0)

**Connexion Google (OAuth), via Supabase Auth.** Un bouton, un tap, pas de mot de passe à retenir.

> **Piège vécu sur BoxBox, à ne pas remanger** : si l'URL de redirection est figée dans une variable
> d'environnement (`NEXT_PUBLIC_SITE_URL`), **le login depuis une preview renvoie sur la prod**. Il faut
> construire le `redirectTo` à partir de l'**origine réelle de la requête**, pas d'une constante — sinon on ne
> peut plus tester un flux authentifié ailleurs qu'en production.

### 4.9 L'app est une PWA (P0)

Ce n'est pas cosmétique : sans ça, pas d'icône sur l'écran d'accueil et un accès caméra bancal.

- `manifest.json` (nom, icônes, `display: standalone`, thème).
- Service worker minimal (coquille applicative en cache — **pas** de synchronisation hors ligne au lancement,
  cf. TBD).
- Icônes et splash, `theme-color`.
- HTTPS obligatoire pour la caméra — fourni par l'hébergeur.

### 4.10 Export de mes données (P0)

Un bouton « exporter » qui sort **tout** — livres, **possessions** (§4.13), **scans à finaliser** (la boîte
de finition, §4.13), lectures (**notes et commentaires compris**), historique des
changements d'état, achats, objectifs, distinctions — en **JSON et CSV**.

Deux raisons, et la seconde est la vraie :
1. Sortir des chiffres pour l'émission dans un tableur si l'envie prend.
2. **Ne jamais être prisonnier de l'app.** Mes données sont à moi et je peux partir avec — c'est la même
   exigence que la portabilité de l'infra (§10).

### 4.11 Objectif du mois (P1)

- Un objectif par mois : une **cible chiffrée par catégorie** (0 = catégorie non visée).
- Jauge de progression par catégorie + état global.
- Modifiable tant que le mois est en cours.
- Bonus **+3 all-or-nothing**, ajouté au total du bilan.

### 4.12 La Bibliothèque — tous les livres (issue #49, décisions du 19/07/2026)

Le journal et la PAL sont des **projections** (les livres à travers leurs lectures / leurs achats) ; la
Bibliothèque montre la table `books` elle-même — y compris les livres **sans aucune trace active**,
invisibles ailleurs (l'angle mort qui a motivé le ticket).

- **7ᵉ onglet de la nav** (« Biblio ») — tranché contre l'entrée cachée dans le Profil : libellés courts.
  **Remplacé le 19/07/2026** par la refonte design : nav **5 onglets** (Journal · Biblio · Scanner au
  centre · Bilan · Profil), la PAL devient un segment de la Biblio, les Stats un segment du Bilan —
  voir `docs/design-specs.md`.
- **v1** : liste (vignette, titre, sous-titre, badge d'état), **recherche en mémoire** titre/série
  (insensible casse et accents — même réserve que les filtres du journal : client tant que pas de
  pagination #32), tri « récents / A→Z », et les **gestes existants** : « je commence », photo de
  couverture (#33/#47). L'édition des métadonnées reste au rescan **(v1 livrée — voir la puce « à
  construire » ci-dessous, qui la remplace)**.
- **Badge d'état** (priorité) : En cours > Lu > Dans la PAL (possédé non lu — l'abandon n'en sort pas,
  §4.6) > Abandonné > **Sans activité** (l'angle mort, enfin visible).
- **Édition de fiche** (issue #100, livrée le 20/07/2026) : **formulaire complet** depuis la Biblio — titre,
  série, numéro, auteurs, éditeur, pages, catégorie. Elle **ne remplace pas le rescan**, elle couvre ce que le
  rescan ne peut pas : un livre **saisi à la main n'a pas de code-barres**, donc rien à rescanner, et sa fiche
  resterait fausse pour toujours. Les champs **code-barres et source restent intouchables** — c'est le pont de
  re-résolution (§7), une saisie humaine dessus le casserait en silence.
  > **Corriger la catégorie recalcule les bilans passés**, et c'est voulu : le score est toujours dérivé (§7),
  > donc le bilan corrigé est le bon — c'était une erreur de saisie. Le formulaire l'annonce avant
  > d'enregistrer, plutôt que de le faire en douce.
- **Fusion de doublons** (issue #100, livrée le 20/07/2026) : deux **saisies manuelles** du même livre ne
  sont pas dédoublonnables à l'écriture — sans code-barres, les `NULL` ne s'égalent pas et l'unicité
  `(user_id, barcode_raw)` ne les bloque pas (§7, voulu). La fusion les réconcilie après coup : lectures,
  achats et possessions changent de livre, puis le doublon est supprimé en douceur.
  - **Tout ou rien** : le travail vit dans une fonction SQL (`merge_books`), donc **une transaction**. À
    moitié faite, elle laisserait des lectures rattachées à un livre effacé, ou deux possessions actives
    violant l'index unique.
  - **Deux codes-barres différents = refus** : ce sont deux éditions, pas un doublon. Ça évite aussi qu'un
    rescan du doublon le **ressuscite** (l'unicité couvre les supprimés, §7) et défasse la fusion.
  - **Manuel × scanné** : le livre conservé **hérite du code-barres** du doublon s'il n'en avait pas — sans
    quoi le survivant resterait non-rescannable.
  - **Les possessions se fusionnent, ne s'additionnent pas** : la plus ancienne acquisition connue l'emporte,
    et le livre reste possédé si l'une des deux déclarations ne l'a pas vendu.
  - **Les lectures terminées identiques sont dédoublonnées** (même date de fin, les deux sans date comprises) :
    deux saisies « déjà lu » du même livre ne sont pas deux lectures, et compteraient double au bilan — on
    garde la plus ancienne, on marque les autres (jamais d'effacement, §7). Les **achats**, eux, restent tels
    quels : le barème sait gérer les exemplaires multiples (§3.3), « je ne l'ai pas acheté » corrige un vrai
    doublon de saisie.
  - Les métadonnées **comblent les trous** sans jamais écraser — même règle que le rescan (§4.2).
- **« Retirer de la bibliothèque »** : suppression douce du **livre seul, sans cascade** — ses lectures et
  achats restent intacts en base mais disparaissent de toutes les vues, car **chaque surface filtre sur
  `books.deleted_at`** (le bilan le faisait déjà ; le journal l'a rejoint — `books!inner` + filtre). 100 %
  réversible : **rescanner le livre le ressuscite avec tout son historique** (résurrection #10), photo
  comprise (l'objet Storage n'est pas touché — rien n'est jamais effacé, §7). La confirmation annonce les
  traces actives qui vont disparaître. L'export (§4.10) continue d'inclure les lignes supprimées.

### 4.13 La possession — « je possède » et « j'ai déjà lu » (issue #101, livré le 20/07/2026)

Le cas manquant depuis le premier jour (§1) : **posséder sans avoir acheté dans l'app**, c'est-à-dire les
étagères d'avant. Sans lui, constituer sa PAL initiale imposait de déclarer 80 « achats », donc 80 malus −1 :
le score plongeait à −80.

**Deux gestes, aucun effet sur le barème.** Une possession n'est pas un achat (pas de malus), et une lecture
sans date de fin ne crédite aucun mois — les points sont datés par `finished_at` (§3, règle 1). `lib/scoring/`
n'a pas été touché : les possessions ne l'atteignent jamais.

#### Le principe : appartenance sans date, flux datés

L'étagère d'avant n'a ni date d'acquisition ni date de lecture connue, et **on ne les invente pas** :

- l'**appartenance** à la pile est un booléen, dérivé sans date ;
- seuls les mouvements **datés** alimentent les entrées/sorties du mois et la courbe de PAL.

Un livre entré sans date connue compte donc dans le **stock** (« Dans la pile ») mais jamais dans les **flux**
— scanner 80 livres un samedi n'affiche aucun pic. La courbe porte une **ligne de base** (les non-datés) qui
préserve l'invariant : *le dernier point vaut toujours la taille réelle de la pile*.

#### Les règles

- **« Je possède »** — date d'acquisition **facultative**. Acquérir un livre **déjà lu** ne le fait pas entrer
  en pile (§3, règle 3 — vrai d'un achat comme d'une déclaration) : il va en Biblio, pas en PAL.
- **« J'ai déjà lu »** — date de fin **facultative**, note et avis capturables. Date connue → les points
  tombent dans le bilan de ce mois-là (déjà clos) ; date vide → aucun mois, aucun point. Refus doux si
  une lecture est **en cours** (le geste juste est « Terminer » au journal). **Depuis #113 (20/07/2026), le
  geste déclare AUSSI la possession par défaut** — aligné sur son titre de section (« Ce livre est déjà à
  moi ») et sur la rafale ; la case « **C'était un emprunt — je ne le possède pas** » bascule en lecture
  seule : un livre de médiathèque lu il y a deux ans est « lu » sans être « possédé », aucune possession
  fabriquée.
- **« Je ne le possède plus »** (don, revente, perte) — le livre sort de la PAL et de la biblio possédée, mais
  **ses lectures et ses points restent au bilan**. À ne pas confondre avec « Retirer » (§4.12), qui masque le
  livre et toutes ses traces. L'achat n'est **jamais** touché : son malus historique est acquis, le mois est
  clos.
- **La possession déclarée fait autorité** quand elle existe — elle seule sait dire « je ne le possède plus »
  d'un livre pourtant acheté.
- Une **fin de lecture non datée prime sur un don** pour la sortie : dater la sortie au don placerait le
  mouvement dans le mauvais mois.

#### Ce qu'une lecture non datée compte quand même

Elle pèse dans les totaux qui **ne se datent pas** — volume total lu, répartition par catégorie, pages, et
moyennes de notes par série et par éditeur. Elle est exclue de tout ce qui se date : mois, année, durée de
lecture, courbe de PAL, et le **classement** (qui affiche une date de lecture).

> ⚠️ **Conséquence à connaître** : « j'ai lu N bouquins » inclut désormais les lectures rétroactives. C'est
> voulu (ce sont de vraies lectures), mais le chiffre ne veut plus dire « depuis que j'utilise l'app ».

#### Une seule règle de pile, trois surfaces

La question « ce livre est-il dans la pile ? » n'est écrite **qu'une fois** (`lib/pal/derive-pal.ts`), et les
trois surfaces qui l'affichent y passent : la **Pile** (§4.6), les **Stats** (§4.5) et la **Biblio** (§4.12).
C'est ce qui garantit qu'elles racontent la même histoire — et c'est ce qui a permis d'ajouter la possession
sans réécrire quoi que ce soit.

#### Le scan d'étagère — la rafale (lot C, livré le 20/07/2026)

Déclarer un livre à la fois ne tient pas à l'échelle d'une étagère : le geste réel, c'est 50 scans d'affilée.
**La chaîne ne s'arrête jamais**, et trois choix en découlent.

- **La capture est découplée de la résolution.** La ligne apparaît dans la liste de session **avant toute
  requête** ; la cascade tourne en arrière-plan et met la ligne à jour quand elle revient. Le scan n'attend
  jamais le réseau. (Cette architecture préfigure le mode hors ligne du §11, sans le livrer.)
- **Aucun scan n'est perdu.** Introuvable, choix de numéro, « image oui infos non », réseau coupé : tout part
  dans la **boîte de finition** (`scan_inbox`) **avec l'intention déjà déclarée**, qui n'est donc jamais
  redemandée. On scanne à la cave, on complète le soir : la boîte survit aux sessions.
- **L'intention vaut pour toute la session** — on range une étagère de possédés, puis une de déjà-lus, puis
  le retour de médiathèque. **Trois intentions** (#113, 20/07/2026) : « Je possède » (possession seule),
  « **Possédé, déjà lu** » (les deux faits — sans la possession, le livre serait indiscernable d'un emprunt)
  et « **Lu — emprunt** » (lecture seule, **aucune possession fabriquée** : médiathèque, prêt d'un ami — le
  livre n'entre jamais dans la pile §4.5, et sa lecture datée crédite son mois comme n'importe quelle autre :
  lire = lire, seul l'achat a un malus).

**La catégorie se corrige inline** dans la liste de session (une puce, un tiroir partagé), sans jamais
interrompre le scan — la mettre dans la boucle l'arrêterait. Un marqueur « ? » ne s'affiche que sur les
**devinettes VF** (§5.5) : GCD et Metron portent un vrai `series_type`, la VF n'a que des indices. Signaler
partout reviendrait à ne rien signaler.

**Le livre sans code-barres, dans la boucle** (#108, livré le 20/07/2026) — le neuvième cas de l'étagère.
Les étagères d'avant l'app sont précisément celles des vieux livres, éditions anciennes et occasions, dont
beaucoup n'ont aucun code-barres lisible. Un bouton « **Pas de code-barres — photographier** » ouvre la prise
de photo **sans quitter la rafale** : la couverture part dans la boîte de finition (`scan_inbox`,
`barcode_raw` null, photo obligatoire à défaut) avec l'intention et la date de la session, exactement comme
les autres captures. La photo n'identifie rien (pas d'OCR) — elle sert d'**identité visuelle** pour la
finition, où l'utilisateur saisit les infos sous les yeux (même principe que §5.4).

> **Le vrai obstacle, tranché : deux flux caméra ne cohabitent pas.** Le scanner tient un `MediaStream`
> (`getUserMedia`) ; la capture passe par la caméra native de l'OS (`<input capture>`). Passer à la photo
> **démonte** donc le scanner (son cleanup libère les pistes du flux) et en revenir le **remonte** — caméra
> fraîche, reprise « toute seule », jamais deux flux tenus en même temps. Annuler ramène au scan actif sans
> ligne fantôme. La photo, sans `book_id` encore, est indexée sur `{user_id}/inbox-{uuid}.webp` (préfixe
> `inbox-` pour ne pas heurter la photo d'un livre) et reste une **photo maison**, donc reprenable plus tard
> (#47).

---

## 5. Le scan — architecture

### 5.1 Un seul point d'entrée : le code se route lui-même

Pas de parcours séparés (« je scanne un comic » / « je scanne une BD ») : **les premiers chiffres du code disent
ce que c'est.**

| Code scanné | Ce que c'est | Où on cherche |
|---|---|---|
| EAN-13 préfixé **978 / 979** | Un **ISBN** — BD, manga, roman, **et les TPB / omnibus VO** | GCD (par ISBN) → **BnF** → Google Books |
| **UPC-A** 12 chiffres (tout le reste) | Un **fascicule VO** | GCD (code exact, sinon **par préfixe**) |

**Le supplément de 5 chiffres n'a pas le même sens selon le support** — piège classique :

| Support | Code | Sens des 5 chiffres |
|---|---|---|
| Fascicule (issue) | UPC-A 12 + 5 | **numéro d'issue, couverture, tirage** → on le garde |
| TPB / omnibus / roman | EAN-13 (`978…`) + 5 | **le prix** (`51095` = 10,95 $) → on le jette |

### 5.2 La cascade de résolution

```
GCD, en base (identifie : comics VO + BD franco-belge)
  → BnF (identifie : tout ce qui est publié en France — BD, manga VF, romans)
    → Google Books (complète : couvertures + romans étrangers) — CLÉ OBLIGATOIRE
      → Metron (enrichit la VO : couverture + series_type)
        → saisie manuelle + photo (le filet ultime, toujours disponible)
```

> **Raffiné le 19/07/2026 (issue #55)** : même quand l'identification rate PARTOUT, la **chaîne couverture**
> (§5.4) est tentée sur un ISBN avant de rendre « introuvable » — mesuré : les libraires (epagine) distribuent
> des livres qu'aucune base bibliographique ne connaît (l'auto-édition française, ex. Northstar Comics). La
> saisie manuelle s'ouvre alors **avec l'image et son explication** (« la couverture vient des libraires, ce
> livre n'est répertorié nulle part — remplis ses infos ») : l'utilisateur saisit le reste, la couverture
> sous les yeux. Et une **saisie manuelle rattachée à un code-barres part dans `barcode_cache`**
> (`source: "manual"`) : le premier qui saisit un livre inconnu le saisit pour tous les rescans — et, à
> l'ouverture multi-utilisateur, pour les autres (faits bibliographiques, aucun droit en jeu — contrairement
> au pool de photos, §5.4). Une entrée d'une **vraie source n'est jamais écrasée** par du manuel, et la
> qualité (fautes de frappe propagées) sera à re-peser au multi-user : provenance affichée + correction.

**Chaque source apporte ce qu'aucune autre n'a.** On n'en ajoute pas une de plus : chacune coûte une
implémentation, un cas d'erreur et un test.

| Source | Ce qu'elle identifie | Mesuré |
|---|---|---|
| **GCD**, importé chez nous (~75 Mo) | Comics VO **et BD franco-belge** — match par code complet, **par préfixe**, ou **par ISBN**. Zéro réseau, zéro quota. | 559 516 lignes, dont **89 314 FR** |
| **BnF** (API SRU, **gratuite, sans clé**) | **Tout ce qui est publié en France** : BD, **manga VF**, romans. C'est le **dépôt légal** — la couverture est exhaustive **par obligation légale**. | **95 %** (19/20 sur des ISBN réels de BD et manga : Dargaud, Delcourt, Ki-oon, Kana, Kazé, Ankama…) |
| **Google Books** (**clé obligatoire**) | Les **couvertures** (la BnF n'en fournit pas) et les **romans étrangers**. | cf. l'avertissement ci-dessous |
| **Metron** | Enrichit la **VO** : couverture + `series_type`. | — |

> **⚠️ Google Books EXIGE une clé — ce n'est pas une optimisation.** Testé : **429 sur tous les appels** depuis
> une IP de datacenter, et **re-mesuré le 13/07/2026 : 429 aussi depuis une IP résidentielle**. Sans clé,
> Google Books est inutilisable **partout, même en dev local**. La clé est gratuite (1 000 req/jour), et
> **côté serveur** comme le reste. Clé créée et vérifiée le 13/07/2026.

**Open Library a été écartée** (cf. §13) : testée sur de la BD française, elle trouve **0 sur 6**. Elle n'apporte
rien que la BnF ne fasse mieux.

**Le principe reste le même que pour la VO : une source identifie, une autre habille.**
GCD et la BnF **identifient** ; Metron, Google Books et — en dernier recours — **la photo** fournissent la
**couverture**.

**Contrainte d'architecture** : la résolution vit derrière une **interface de providers**
(`resolveByBarcode`, `resolveByIsbn`), implémentations interchangeables essayées en cascade. Changer ou ajouter
une source = un branchement, pas une réécriture.

Ni **League of Comic Geeks** (aucune API publique) ni **CLZ** (base propriétaire) ne sont exploitables : tous deux
maintiennent leur propre base — ils font exactement ce qu'on fait ici.

### 5.3 Ce que le scan capte, et ce que l'app en fait

Dégradation douce : **jamais d'échec sec**.

| Ce que le scan capte | Ce que fait l'app |
|---|---|
| Code complet (UPC + supplément) | **Issue exacte, zéro question** — GCD, sinon **Metron par code exact AVANT les listes par préfixe** (vécu : un indé absent de GCD dont le préfixe, partagé, aurait affiché des listes sans rapport — 14/07/2026) |
| 12 chiffres, préfixe net (**81,7 %** des cas) | Série connue → *« quel numéro ? »*, **un tap** (liste des numéros de la série, pas de clavier). **Dédupliquée par numéro** : GCD indexe chaque variante de couverture comme une ligne, or la variante n'a aucune importance au barème — le représentant gardé est la couverture principale (celle que Metron référence). Vécu sur Alias: Red Band, 14/07/2026. |
| 12 chiffres, préfixe partagé (18,3 %) | **Liste courte** des séries possibles → **deux taps** |
| ISBN | Résolution directe : GCD, puis **BnF** (dépôt légal français) |
| Rien / inconnu | **Saisie manuelle** série + numéro, série **mémorisée** (la 2ᵉ issue prend 3 secondes). *Périmètre décidé le 19/07/2026 (#35) : LA dernière série (+ sa catégorie), en `localStorage` — pas de liste, pas de table.* |

Rappel technique : **`BarcodeDetector` natif ne renvoie pas le supplément de 5 chiffres.** Et **mesuré le
14/07/2026 : le port JavaScript de ZXing (`@zxing/library`) non plus** — son décodeur d'extensions est cassé
(testé sur image synthétique parfaite, à tous les offsets : `NotFoundException` systématique). C'est
**zxing-wasm** (le ZXing C++ compilé en WebAssembly, maintenu) qui lit le supplément (`eanAddOnSymbol: Read`),
avec deux particularités mesurées : il rend l'UPC-A sous forme EAN-13 (zéro de tête, retiré par le routeur) et
ne cherche le supplément que dans une fenêtre d'écart stricte (~9-10 modules — les codes réels sont conformes).
Un test de non-régression sur codes synthétiques verrouille tout ça. Le supplément reste une lecture
opportuniste (fenêtre de grâce d'1,5 s au scan) : on ne peut jamais compter dessus — d'où cette cascade.

### 5.4 Les couvertures — la photo est la vraie réponse

**Constat vérifié : il n'existe aucune source de couvertures VO à la fois gratuite, fiable et utilisable
commercialement.** C'est logique — une couverture est une **œuvre sous copyright de l'éditeur**.

| Source | Verdict |
|---|---|
| **Comic Vine** | La plus grosse base d'images, indé compris — mais **usage commercial explicitement interdit** (clé révoquée), 200 req/h. |
| **GCD** | Les scans existent sur le site mais **pas dans le dump** (vérifié : aucune table `cover`). Hotlinker = fragile et discourtois. |
| **Google Books** | Couvertures **par ISBN seulement** → parfait pour BD, manga, roman, TPB, omnibus. **Inutile pour les fascicules**, et **exige une clé** (429 systématique sans clé, même en résidentiel). |
| **BnF** | Identifie très bien (95 %) et, depuis le **17/02/2026**, expose un **Service Couvertures officiel** (bêta) — ✅ **ajouté le 19/07/2026** : par ISBN/EAN/ark, gratuit, sans clé, conditions BnF (source créditée). Mesuré : HEAD refusé (405), **image absente = HTTP 500** (pas 404), fonds récent clairsemé. |
| **Marvel API** | Gratuite et officielle, mais **Marvel uniquement** → ne résout pas l'indé. |
| **Metron** | Héberge des couvertures, gratuit — mais CGU « usage personnel », même limite qu'ailleurs. |
| **OpenLibrary** | ✅ **Ajoutée le 19/07/2026** — par ISBN, gratuite, **sans clé**, hotlink accepté. Mesuré : bonne sur les romans, correcte sur le manga VF, variable sur la BD. |
| **Inventaire.io** | ✅ **Ajoutée le 19/07/2026** — projet ouvert (données CC0), API par ISBN sans clé, images communautaires. Point fort mesuré : le fonds **francophone**. |
| **League of Comic Geeks / CLZ / Bedetheque** | Vérifié le 19/07/2026 : **aucune API publique** — communautés fair use ou base propriétaire payante. Le problème est structurel, pas un trou de recherche. |
| **epagine (`images.epagine.fr`)** | ✅ **Ajoutée le 19/07/2026** — le CDN d'images des libraires français (Place des Libraires, leslibraires.fr) : **la mieux fournie en VF récente** (mesuré : seule source à avoir un Urban Comics 2022 absent partout ailleurs). **Pas d'API publique ni de licence affichée** : hotlink assumé, en **dernier cran seulement**, avec la réparation des couvertures comme filet (voir décision ci-dessous). Motif d'URL mesuré : `/{3 derniers chiffres ISBN}/{isbn}_1_75.jpg` ; **ISBN inconnu = HTTP 200 mais placeholder PNG** (2 687 o) — les vraies couvertures sont des JPEG. |

> **Comic Vine, décision du 19/07/2026** : différée. La plus riche des bases VO (indés compris) mais licence
> **non-commerciale stricte** (clé révocable). À rouvrir **sur mesure d'usage** : si le filet photo se déclenche
> trop souvent sur de la VO ancienne/indé, on tranchera alors la question « l'app restera-t-elle non
> commerciale ? ».

**Décision : cascade automatique, puis la photo.**

1. **Tentative automatique** : Metron (VO) puis, pour tout ISBN sans image, la chaîne **Google Books (avec
   clé) → OpenLibrary → Inventaire → BnF Couvertures → epagine** (décisions du 19/07/2026 — chaque cran ne
   s'exécute que si le précédent n'a rien trouvé : zéro coût sur le chemin heureux, et le résultat part en
   cache, payé une seule fois par code). epagine ferme la marche : la mieux fournie en VF mais la seule sans
   engagement d'ouverture — sollicitée uniquement quand tout le reste a échoué.
   Mesuré le 13/07/2026 sur un petit échantillon VF : Google Books a la **fiche** (pages, éditeur — utile pour
   deviner la catégorie) mais souvent **pas d'`imageLinks`** → les replis OpenLibrary/Inventaire comblent
   (mesuré 3/3 le 19/07/2026 sur manga VF, BD, roman).

> **Découverte mesurée (13/07/2026) : Metron ne référence que la couverture PRINCIPALE d'une issue.**
> GCD indexe chaque variante (Nightwing #123 = 6 codes-barres), Metron une seule — donc le `gcd_id` **d'une
> variante** ne matche pas chez Metron, et son `?upc=` (match exact) non plus. Le supplément UPC encode la
> couverture en **4ᵉ position** (`…123`**`2`**`1` = cover B) : pour retrouver l'issue chez Metron, **normaliser
> le supplément (4ᵉ chiffre → 1)**, sinon retomber sur série + numéro. La couverture récupérée sera celle de la
> cover A ; pour la variante exacte, c'est la photo. Vérifié aussi : le filtre `?gcd_id=` **fonctionne** avec le
> gcd_id de la couverture principale, et compte Metron créé + testé le 13/07/2026.
2. **Sinon, l'app propose de photographier la couverture** — la caméra est **déjà ouverte** pour le scan et le
   livre est **déjà dans la main**. Un tap.

Ce n'est pas un pis-aller, c'est meilleur qu'une API : **100 % de couverture** (y compris le Kickstarter tiré à
500 exemplaires), **zéro risque juridique même en commercialisant** (chacun photographie *sa* pile, aucune
redistribution), **zéro quota**, et c'est **l'exemplaire réel** avec sa vraie variante.

**Stockage** : Supabase Storage, **1 Go gratuit**. Compression **WebP côté client** (~150 Ko/couverture) →
**~6 000 bouquins**. Hors d'atteinte.

> **Décisions du 19/07/2026 (implémentées, issue #33)** :
> - **Bucket `covers` PUBLIC**, chemins `{user_id}/{book_id}.webp` — deux UUID, indevinables, pas de listing.
>   URL directe dans `books.cover_url`, comme les couvertures externes : zéro plomberie d'URLs signées, cache
>   `next/image` intact.
> - **Photos strictement PAR UTILISATEUR** (policies d'écriture par dossier). Le **pool partagé** (« le premier
>   qui photographie, les autres en profitent ») est une piste multi-user volontairement non ouverte : elle
>   sacrifierait l'argument « aucune redistribution » ci-dessus — à re-peser à l'ouverture multi-utilisateur.
> - **La photo est le filet ULTIME** : proposée quand `cover_url` est vide (au scan et dans le panneau
>   Modifier du journal). *Raffiné le 19/07/2026 au soir (#47)* : une couverture de **source** reste
>   intouchable, mais une **photo maison** peut être **reprise** (bouton « Reprendre la photo » au journal,
>   URL versionnée `?v=` pour casser les caches) ; et l'**import galerie** est permis (pas d'attribut
>   `capture` — le navigateur propose nativement caméra ou photothèque). Usage privé, l'argument « aucune
>   redistribution » tient.
> - **Compression** : 800 px de grand côté, WebP qualité 0,8 (~60-150 Ko) ; un seul objet par livre, écrasé.

> **Décisions du 19/07/2026 (deuxième vague — le trou VF)** — déclencheur : *Batman : La Cour des Hiboux*
> (Urban Comics 2022, 9791026820963), fiche Google Books **sans image**, inconnu d'OpenLibrary, d'Inventaire
> et du Service Couvertures BnF ; seule epagine l'avait.
> - **Deux crans ajoutés** à la chaîne ISBN : **BnF Couvertures** (API officielle, légitime) puis **epagine**
>   (le mieux fourni en VF, mais hotlink sans garantie — dernier cran, voir tableau).
> - **Une entrée de cache sans couverture n'est plus figée** : au rescan, la chaîne couverture est retentée
>   et l'entrée **réparée** si elle rapporte — les crans s'étoffant avec le temps, les livres déjà scannés
>   en profitent sans repayer l'identification.
> - **Livré (issue #53, 19/07/2026) — la réparation des liens cassés**, la contrepartie du hotlink epagine :
>   l'image qui ne charge plus (`onError` client, anti-boucle par session) déclenche la re-résolution serveur
>   de la chaîne couverture → `books.cover_url` et l'entrée `barcode_cache` sont réparés, la vignette se
>   remplace sur place. **Le doute profite toujours à l'existant** : la couverture n'est vidée (retour au
>   filet photo #33) que si la chaîne n'a rien ET que l'URL actuelle est CONFIRMÉE morte côté serveur — un
>   `onError` client peut n'être qu'un problème de réseau local. Les photos maison ne passent pas par là
>   (elles sont chez nous). Décision pure et testée (`lib/books/cover-repair.ts`).

### 5.5 Deviner la catégorie du barème

La catégorie est **proposée**, jamais imposée. Ordre des signaux, du plus fiable au moins fiable :

| Signal | Catégorie proposée |
|---|---|
| `series_type` Metron = Single Issue / One-Shot / Annual | `issue` |
| `series_type` Metron = Trade Paperback / Hardcover / Graphic Novel | `comics` |
| `series_type` Metron = Omnibus | `omnibus` |
| Code **UPC-A** (donc fascicule VO) sans autre signal | `issue` |
| Éditeur manga FR renvoyé par la BnF (Glénat, Kana, Pika, Kurokawa, Ki-oon, Kazé, Ankama…) | `manga` |
| Éditeur franco-belge renvoyé par la BnF (Dargaud, Dupuis, Le Lombard, Casterman, Delcourt, Bamboo…) | `bd` |
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
| **Issues avec un ISBN** | **231 792** |
| **Lignes exportées (code-barres OU ISBN)** | **559 516** |
| **Poids de la table réduite, index compris** | **~75 Mo** (1/6 du plafond gratuit Supabase) |

**0. GCD n'est pas qu'américain — et ça change tout pour la VF.** Répartition des issues identifiables (ISBN ou
code-barres) **par langue de la série** :

| Langue | Avec ISBN | Avec code-barres |
|---|---|---|
| Anglais | 75 039 | 340 733 |
| **Français** | **89 314** | 8 162 |
| Néerlandais | 21 077 | 21 395 |
| Allemand | 15 830 | 12 705 |

**Il y a plus d'issues françaises avec ISBN que d'anglaises** : GCD indexe massivement la **BD franco-belge**
(Dargaud, Dupuis, Le Lombard, Casterman…). Conséquence directe : **la BD se résout en base, sans appel réseau**,
au même titre que les comics VO.

> **Piège évité de justesse** : le premier export ne gardait que les issues **avec un code-barres** — or la BD
> française est le plus souvent indexée **par ISBN seul**. On jetait **134 439 lignes**, dont l'essentiel de la
> BD. Or **un code-barres de BD *est* son ISBN** (EAN-13) : ces lignes sont parfaitement scannables. L'export
> garde désormais tout ce qui a **un code-barres OU un ISBN**.

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
- **Export** : `scripts/gcd-export.mjs` → `data/gcd_issues.csv` (559 516 lignes, 38 Mo) et `data/gcd_series.csv`
  (121 308 séries, 6,2 Mo). `data/` est **gitignoré** (régénérable en ~3 min).
- **Chargement** : `COPY` vers Supabase, **dans une transaction** : on vide et on recharge `gcd_issues` d'un
  bloc. C'est une **table jetable**, entièrement reconstructible depuis le dump.

### Le rafraîchissement n'est pas un problème — et voici pourquoi

**On n'aura presque jamais besoin de le refaire.** Ce qui manque dans une base GCD vieille de trois mois, ce sont
les **nouveautés** — ~1 500 issues par mois. Or les nouveautés, c'est exactement ce que **Metron** couvre le mieux
(il est alimenté chaque semaine sur les sorties).

**Donc la base se complète toute seule à l'usage :**

| Source | Rôle |
|---|---|
| **GCD** (import massif) | Le **fonds historique** : 559 000 lignes — comics VO, indé, rétro **et BD franco-belge** |
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

> **⚠️ Suppression douce partout — la vision (§1) l'exige, le schéma doit le fournir.**
> `books`, `readings` et `purchases` portent un **`deleted_at`** (timestamptz, nullable). « Supprimer » = le
> renseigner ; toutes les requêtes de l'app filtrent `deleted_at IS NULL`. **Aucun `DELETE` SQL sur les données
> utilisateur, jamais** — une lecture enregistrée par erreur se marque, elle ne se détruit pas. L'export (§4.10)
> inclut aussi les lignes supprimées : ce sont les données de l'utilisateur, toutes.

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
| `metadata_source` | `gcd` / `bnf` / `google_books` / `metron` / `manual` |
| `metadata_source_id` | L'identifiant chez la source (dont le **`gcd_id`**) — permet de re-résoudre plus tard |

**Contrainte d'unicité : `(user_id, barcode_raw)`.** Un rescan réutilise le livre existant, il n'en crée jamais
un second (cf. §4.2). Les livres **saisis à la main** ont un `barcode_raw` **nul** : en PostgreSQL les `NULL` ne
s'égalent pas, donc la contrainte **ne les bloque pas** — deux saisies manuelles restent possibles, ce qui est le
comportement voulu (on ne peut pas dédupliquer ce qui n'a pas de code).

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
| `rating` | note sur **5**, demi-étoiles permises (`numeric(2,1)`, 0,5 → 5), **nullable** |
| `comment` | avis libre, **nullable** |

> `rating` et `comment` sont **facultatifs** : une lecture terminée sans note rapporte ses points normalement.
> Mais les **colonnes existent dès la première version** — une note non capturée est perdue pour toujours.

> **⚠️ `started_at` et `finished_at` sont nullables — décision du 20/07/2026 (#101), et elle a un prix.**
> Le geste « j'ai déjà lu » (§12) doit pouvoir enregistrer une lecture de l'étagère d'avant **sans inventer de
> date**. Deux contraintes d'origine sont donc tombées : `readings_finished_has_date` et le `NOT NULL` sur
> `started_at`. La règle « pas de date → pas de points » est désormais portée par le **moteur** (les points sont
> datés par `finished_at`, §3 règle 1), plus par le schéma.
>
> **Ce que ça coûte, et ce qui le compense.** La base ne rattrapait plus une lecture normalement suivie dans
> l'app qui perdrait sa date de fin — des points disparus du bilan, en silence. Un filet **affiné** l'a
> remplacée : *une lecture terminée sans date de fin doit aussi être sans date de début*
> (`readings_undated_finish_has_no_start`). Une lecture commencée dans l'app a forcément un `started_at` : le
> seul cas fautif casse, les quatre cas légitimes passent (en cours ; suivie de bout en bout ; « déjà lu » avec
> fin connue ; « déjà lu » sans rien). Les gardes applicatives restent en première ligne.
>
> Corollaire sur `reading_events.occurred_at`, que le trigger dérive de ces deux colonnes : **nullable** aussi.
> Un événement sans date reste au journal (rien n'est jamais effacé) mais **ne compte dans aucun mois** — une
> date inventée polluerait les comptages d'abandons et de reprises (§4.5), et plus rien ne la distinguerait
> ensuite d'une vraie.

**`reading_events`** — le **journal d'états, en append-only** : `reading_id`, `status`, `occurred_at`. Une ligne
à chaque changement, **jamais d'effacement**. C'est lui qui permet de compter les **abandons** et les
**reprises**, et de supporter plusieurs cycles sur un même bouquin. `readings.status` n'est que le **dernier
état connu** — une commodité de lecture, pas la vérité historique.

**`purchases`** — un achat : `user_id`, `book_id`, `purchased_at` (date).

**`ownerships`** — la **possession déclarée** (§4.13), indépendante de l'achat.

| Colonne | Rôle |
|---|---|
| `user_id`, `book_id` | |
| `owned_since` | date **nullable** — l'étagère d'avant n'a pas de date d'acquisition connue. Renseignée : le livre entre dans la courbe et les flux ; vide : il compte dans le **stock** seulement |
| `disposed_at` | date **nullable** — renseignée = « je ne le possède plus » (don, revente, perte) |

**Une seule déclaration active par livre** (index unique partiel sur `(user_id, book_id) where deleted_at is
null`) : la possession est un **état**, pas un historique d'exemplaires. Quand elle existe, elle **fait
autorité** sur la possession — elle seule sait dire « je ne le possède plus » d'un livre pourtant acheté ;
sinon, un achat actif vaut possession.

> **Aucune lecture de cette table par le moteur de score.** C'est ce qui garantit qu'une possession ne peut
> pas peser sur le barème, quoi qu'il arrive ensuite.

**`monthly_picks`** (P1) — les **distinctions du mois** : `user_id`, `month` (1er du mois), `kind` (**enum** :
`favorite` / `good_surprise` / `bad_surprise`), `reading_id`, `comment`. Une distinction de chaque type par mois
au maximum (unicité sur `(user_id, month, kind)`).

**`monthly_objectives`** (P1) — `user_id`, `month` (1er du mois).
**`objective_targets`** (P1) — `objective_id`, `category`, `target_count`.

### Tables de référence (GCD, en lecture seule)

**`gcd_issues`** — **`gcd_id`**, `barcode` *(indexé)*, `barcode_prefix` *(indexé)*, `series_id`, `number`,
`isbn` *(indexé)*, `page_count`, `key_date`, `title`. **559 516 lignes** — tout ce qui a **un code-barres OU un
ISBN** (donc la BD franco-belge, indexée par ISBN).

**`gcd_series`** — `id`, `name`, `format`, `year_began`, `publisher`, `language_id`. 121 308 lignes.

Ces deux tables sont **jetables** : écrasées à chaque rafraîchissement du dump, entièrement reconstructibles.

**`barcode_cache`** — **notre** table, celle qui grossit toute seule : les résolutions obtenues **auprès de la
BnF, de Metron ou de Google Books** (tout ce que GCD n'a pas). `barcode` (UPC ou ISBN), métadonnées normalisées,
source, `resolved_at`.

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

**Combien d'appels réseau pour identifier un bouquin ? Ça dépend du bouquin — et il faut être précis.**

| Ce que je scanne | Résolu où | Appels réseau | Latence |
|---|---|---|---|
| **Comic VO** (fascicule, TPB, omnibus) | **GCD, en base** | **0** | quelques **ms** |
| **BD franco-belge** | **GCD, en base** (par ISBN — 89 314 issues FR indexées) | **0** | quelques **ms** |
| **Manga VF, roman FR, BD absente de GCD** | **BnF** (dépôt légal, 95 %) | **1** | ~300-800 ms |
| **Nouveauté / roman étranger** | Metron ou Google Books, puis cache | **1** | ~300-800 ms |
| **Déjà scanné une fois** (n'importe quoi) | **notre cache** | **0** | quelques **ms** |

**L'essentiel se résout en base, sans réseau** : 559 516 lignes, c'est petit pour Postgres — trois index
(`barcode`, `barcode_prefix`, `isbn`) et la recherche prend quelques millisecondes.

**Quand il y a un appel réseau, il coûte ~300-800 ms** — imperceptible au milieu du geste de scan (on est en
train de cadrer un code-barres) — et il n'a lieu **qu'une seule fois par bouquin** : la résolution part ensuite
dans `barcode_cache`, définitivement.

**Aucune source n'est un point de rupture.** Si la BnF ou Google Books tombent, on descend d'un cran dans la
cascade, jusqu'à la saisie manuelle. Le scan ne peut pas échouer.

**Toute résolution externe est mise en cache.** Un bouquin n'est jamais résolu deux fois. Avec 4-5 utilisateurs,
on parle de quelques dizaines d'appels par mois — tous les quotas sont hors d'atteinte. Depuis l'issue #55,
« jamais résolu deux fois » vaut aussi pour la **saisie manuelle** : rattachée à un code-barres, elle entre
dans `barcode_cache` (`source: "manual"`) et le rescan la restitue sans rien redemander.

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
| Auth | Supabase Auth — **Google OAuth** (⚠️ `redirectTo` sur l'origine réelle, cf. §4.8) |
| Stockage images | Supabase Storage (1 Go gratuit) |
| **Identification d'un scan** | **GCD importé chez nous** — 559 516 lignes, match par code complet, **par préfixe**, ou **par ISBN** |
| **Identification VF** | **BnF** — API SRU, gratuite, sans clé, **dépôt légal** (95 % mesuré) |
| Couvertures VF, romans étrangers | Google Books — **clé obligatoire** (429 sans clé, partout) |
| Enrichissement VO | Metron — **couverture** + `series_type` (Basic Auth, **côté serveur**) |
| Scan | **zxing-wasm** (ZXing C++ en WebAssembly — seul à décoder le supplément 5 chiffres ; le port JS de ZXing a un décodeur d'extensions cassé, mesuré) |
| Hébergement | Vercel |
| Tests | Vitest (logique de scoring) |

**Plan gratuit Supabase** : 500 Mo de base (on en utilise ~75), 1 Go de stockage, **2 projets** (BoxBox +
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
- **Export utilisateur** (§4.10) : les données sortent de l'app en un clic.

### Coûts — tout est gratuit, avec un seul astérisque

| Poste | Coût | Plafond |
|---|---|---|
| Supabase | **0 €** | 500 Mo de base (on en utilise ~75), 1 Go de stockage, 2 projets |
| Vercel | **0 €** | Plan Hobby |
| GCD | **0 €** | Dump libre (CC BY-SA) |
| Metron | **0 €** | 20 req/min — hors d'atteinte avec le cache |
| BnF | **0 €** | API SRU publique, sans clé |
| Google Books | **0 €** | 1 000 req/jour **avec clé** (sans clé : 429, partout) |

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
  dates de lecture toujours libres, jamais figées à la date de saisie. **Le geste « déjà lu » (#101) en livre
  le socle** (une lecture rétroactive datée crédite son mois passé) ; seul l'outillage de ressaisie **en
  masse** reste ici.
- **« Je possède » et « j'ai déjà lu »** — **livrés le 20/07/2026**, voir **§4.13**. Le **lot C** aussi : le
  mode **rafale** (scan d'étagère qui ne s'arrête jamais), la **boîte de finition** persistante (`scan_inbox`)
  pour les scans à compléter, et la **correction de catégorie inline** dans la liste de session. Le neuvième
  et dernier cas de la rafale — le **livre sans code-barres photographié dans la boucle** (#108) — a suivi le
  même jour. Les 9 cas de la rafale sont analysés dans l'issue #101.
- **Wishlist et favoris** : scanner en librairie un bouquin qu'on ne prend pas (wishlist), marquer ses coups de
  cœur (favoris). **L'architecture les accueille déjà** — ce sera un bouton de plus sur la feuille du scan et une
  table par action. Et la wishlist nourrit la santé de la PAL : *ce que je convoite* vs *ce que j'achète* vs *ce
  que je lis*, c'est le récit complet de l'émission.
- **Mode multi** (P2) : comparaison mensuelle Prem vs Léna + « meilleur paliste du mois » (+5).
- **Notifications** : rappel de fin de mois, objectif presque atteint.
- **Instance Metron auto-hébergée** : leur code est en GPL, leurs données en CC BY-SA — une option si le volume
  d'appels dépassait un jour leur usage « personnel normal ». Peu probable : GCD fait déjà l'identification, et
  Metron ne sert qu'aux couvertures.

## 13. Idées écartées — et pourquoi

> À lire avant de reproposer quoi que ce soit d'ici. Une idée écartée avec son motif vaut mieux qu'une idée
> qu'on redécouvre tous les six mois.

**Open Library comme troisième source.** Google Books couvre déjà la VF (BD, manga, roman). Ajouter un
fournisseur, c'est une implémentation, un cas d'erreur et un test de plus **pour un gain marginal**. **Écartée** —
à rebrancher (en une heure, l'interface de providers est là pour ça) **si et seulement si** Google Books s'avère
trouer sur la BD franco-belge. On ne construit pas contre un problème hypothétique.

**La « hype » déclarée au scan** *(pour rendre les surprises calculables — cf. §4.4)*. L'idée : noter de 1 à 3 ce
qu'on attend d'un bouquin au moment du scan ; à la fin, `note − attente` donnerait automatiquement la bonne
surprise et la déception du mois. **Écartée**, pour trois raisons :

1. **Ça met de la friction au pire endroit.** Le scan est le geste qu'on répète des centaines de fois, et sa
   fluidité conditionne **toutes** les stats. Le charger pour alimenter une feature utilisée **trois fois par
   mois**, c'est le mauvais échange.
2. **Ça résout un problème inexistant.** Choisir trois distinctions en fin de mois prend trente secondes — et on
   les connaît déjà sans qu'un algorithme nous les souffle.
3. **La donnée serait mauvaise.** Au moment du scan, on ne sait souvent pas ce qu'on attend d'un livre. Une hype
   déclarée à l'arrache produirait des « bonnes surprises » calculées sur du bruit : **un chiffre, pas une
   vérité**.
