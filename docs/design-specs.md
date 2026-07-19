# Objectif PAL — Specs design (refonte UX/UI)

> Décisions du 19/07/2026, validées sur proto interactif. C'est le cahier des charges de la refonte
> visuelle et de la nouvelle navigation. Le produit (flux, règles, barème) ne change pas : voir
> `product-specs.md`, qui reste la source de vérité produit.
>
> Proto de référence : **`docs/design-proto.html`** (autonome, zéro dépendance — s'ouvre dans
> n'importe quel navigateur, idéalement en viewport mobile). Aussi publié comme artifact Claude :
> https://claude.ai/code/artifact/c212e7f5-1172-4a53-b148-16d53d1bcde2

## 1. Le diagnostic — pourquoi une refonte

L'UI actuelle est le starter Tailwind à peine habillé : aucune identité (fond blanc/noir, accent
`amber-500` posé en dur dans les composants), **7 onglets** compressés dans la barre du bas, pas de
composants de base partagés — chaque écran restyle dans son coin. La structure, elle, est saine
(mobile-first, `max-w-md`, a11y) : la refonte est un **rhabillage + une refonte de nav**, pas une
réécriture des flux.

Deux problèmes tranchés :
1. **Fade / sans personnalité** → on adopte l'identité visuelle de l'émission.
2. **Nav 7 onglets illisible** → on descend à **5 onglets avec le scan au centre**.

## 2. L'identité — la nuit du plateau

Reprise de l'identité de l'émission (affiche « Qui va gagner ? ») : fond nuit violette, dégradé
signature, confettis, énergie jeu télévisé.

### Tokens couleur

| Token | Valeur | Rôle |
|---|---|---|
| `--bg0` | `#120826` | Fond profond (body) |
| `--bg1` | `#1B0F38` | Fond secondaire (dégradé de scène) |
| `--card` | `#221345` | Surfaces (cartes, chips, barres) |
| `--card2` | `#2B1A55` | Surface relevée (boutons ghost, jauges) |
| `--line` | `rgba(255,255,255,.08)` | Bordures |
| `--ink` | `#F4EFFC` | Texte principal (blanc lavande, pas blanc pur) |
| `--ink2` | `#B3A5D6` | Texte secondaire |
| `--ink3` | `#8474AC` | Texte tertiaire / labels |
| `--magenta` | `#F32FB6` | Composante du dégradé |
| `--violet` | `#8C5CF6` | Composante du dégradé |
| `--cyan` | `#2BD7F0` | Composante du dégradé · état « En cours » |
| `--green` | `#3BE596` | Composante du dégradé · sémantique positif, « Lu » |
| `--amber` | `#FFB63B` | Étoiles de notation · « Sans activité » |
| `--red` | `#FF5470` | Sémantique négatif (malus, solde qui gonfle, déconnexion) |

**Le dégradé signature** : `linear-gradient(100deg, #F32FB6, #8C5CF6 45%, #2BD7F0 75%, #3BE596)`.
C'est LA marque — il est réservé aux moments qui comptent : bouton scan central, segment actif,
score du mois, CTA principaux (« Je commence », « Copier pour l'antenne »), logo « PAL », indicateur
d'onglet actif. **Partout ailleurs, la page reste calme** (surfaces violettes sombres, texte lavande) —
c'est ce contraste qui fait tenir le dégradé sans vulgarité.

**Sémantique ≠ accent** : vert/rouge/ambre portent le sens (positif, négatif, note), jamais la déco.
Attention PAL : un solde **positif** (la pile gonfle) est **rouge**, un solde négatif est **vert**.

### Thème

**Sombre unique, assumé** : la nuit du plateau est l'identité, l'app vit dedans (usage du soir,
librairie, métro). On supprime la bascule `prefers-color-scheme` actuelle. *TBD : une variante claire
si l'usage en plein soleil (scan en librairie) le réclame — à trancher à l'usage, pas avant.*

**Répercussions PWA** (étape 1 du chantier §7) : `app/manifest.ts` porte `background_color` et
`theme_color` à `#0a0a0a` → à migrer vers `--bg0` (`#120826`), sinon le splash screen et la barre
système resteront sur l'ancien noir. Les **icônes** (`/icons/icon-*.png`, écran d'accueil) sont un
livrable de la nouvelle identité.

### Typographie

- **Système** (`system-ui`) partout — c'est une PWA, zéro webfont à charger.
- **Titres d'écran** : 900 italique, MAJUSCULES, letter-spacing léger négatif — l'énergie
  « QUI VA GAGNER ? ». Un mot-clé du titre peut porter le dégradé en `background-clip: text`.
- **Corps** : 400/600/700 normaux. Labels de sections : 12px, 800, majuscules, letter-spacing `.1em`,
  `--ink3`.
- **Chiffres alignés** : `font-variant-numeric: tabular-nums` sur toute colonne de nombres
  (points, compteurs, dates).

### Matière

- Rayons : 20px pour les cartes, 12px pour les boutons, pills (`999px`) pour badges/chips/segments.
- Confettis : **décor de scène discret** (login, éventuellement fond d'écran vide), jamais dans les
  listes. Exception rituelle : voir « le moment de gloire » §5.
- Ombres : réservées aux éléments flottants (FAB scan, toasts) — teintées violet
  (`rgba(140,92,246,…)`), pas noires.

## 3. La navigation — 5 onglets, scan au centre

Remplace les 7 onglets actuels. Le « combo B » : le Journal garde son onglet (c'est là que vit
« Terminé ✓ », le geste quotidien qui score), la PAL devient un segment de la Bibliothèque, les Stats
un segment du Bilan.

| Position | Onglet | Contenu | Segments |
|---|---|---|---|
| 1 | **Journal** | Les lectures (inchangé) | — (chips de filtre existantes) |
| 2 | **Biblio** | Tous les livres possédés | **Pile (PAL)** · **Tous** |
| 3 (centre) | **Scanner** | Le flux scan (inchangé), reste la route `/` | — |
| 4 | **Bilan** | Le livrable mensuel | **Bilan** · **Stats** |
| 5 | **Profil** | Compte, exports, crédits (inchangé) | — |

- **Le bouton scan central** : rond 60px, dégradé signature, surélevé (déborde de la barre, bordure
  4px couleur fond, ombre violette). C'est le seul élément « spectaculaire » de la barre.
- Onglets inactifs : `--ink3`. Actif : `--ink` + trait dégradé 14×3px sous le libellé.
- Modèles mentaux : Journal = « ce que je lis », Biblio = « ce que je possède », Bilan = « mes
  chiffres ». Chaque segment s'ouvre sur son premier volet (Pile, Bilan) — le plus fréquent.
- **Routes conservées** : `/journal`, `/bibliotheque` (+ `/pal` redirige vers le segment Pile),
  `/bilan` (+ `/stats` redirige vers le segment Stats). Les segments sont de l'état d'URL
  (`?vue=pile|tous`, `?vue=bilan|stats`) pour rester partageables/rechargeables. Le param est en
  **français assumé** : les chemins le sont déjà (`/bibliotheque`, `/bilan`) — dans ce repo, l'URL
  entière est une surface utilisateur francophone, et un `?view=` anglais créerait une incohérence
  chemin/param. La règle « code en anglais » s'applique au code qui le lit, pas à sa valeur.

### Ce que la fusion rationalise (dette au passage)

- La « santé de la PAL » (taille + solde du mois) est aujourd'hui calculée à **3 endroits**
  (écran PAL, Bilan, Stats) par des moteurs différents → **une seule dérivation partagée**.
- Le geste « Je commence » existe en triple (Scanner, PAL, Biblio) → un composant unique.
- Les gestes photo-de-couverture et retrait/soft-delete, dupliqués sur 3 écrans → composants uniques.

## 4. Les composants de base (à créer dans `components/ui/`)

Aujourd'hui il n'existe aucun composant partagé — c'est la cause de l'incohérence. La refonte en crée
une petite famille, stylée une fois sur les tokens :

| Composant | Variantes / états |
|---|---|
| `Button` | `grad` (CTA, dégradé + ombre violette) · `ghost` (surface `--card2`) · `done` (vert, « Terminé ✓ ») · bloc/inline |
| `Card` | Surface `--card`, bordure `--line`, rayon 20px |
| `Badge` | `reading` (cyan) · `done` (vert) · `pile` (magenta) · `abandoned` (muet) · `idle` (ambre) — mêmes priorités qu'en §4.12 des specs produit |
| `SegmentedControl` | Pill, segment actif en dégradé — porte les vues Biblio et Bilan |
| `FilterChips` | Les filtres du journal, restylés (pill, actif dégradé) |
| `StatTile` | Label majuscule + grande valeur `tabular-nums` + hint ; valeur colorable (sémantique) |
| `Toast` | Pill flottante bas d'écran (confirmation copie, lecture terminée) |
| `BookRow` | Vignette 46×64 + titre + méta + zone d'action à droite — LA ligne partagée Journal/Biblio |
| `Stars` | Notation ambre, demi-étoiles |

Les vignettes sans couverture reçoivent un **placeholder dégradé + initiale** (6 dégradés dérivés de
la palette, choisis par hash du titre — stable d'un rendu à l'autre).

## 5. Écran par écran

- **Scanner** (accueil) : viseur avec coins en dégradé et ligne de scan animée (désactivée sous
  `prefers-reduced-motion`), champ code-barres, lien saisie manuelle. Le flux (sheet, ambiguïtés,
  saisie manuelle) ne change pas — il est rhabillé.
- **Journal** : chips de filtre + liste `BookRow`. **Le moment de gloire** : « Terminé ✓ » déclenche
  une **micro-pluie de confettis** aux couleurs de la palette + toast « Lecture terminée · +N pts 🎉 »
  (respecte `prefers-reduced-motion` ; N vient du barème réel, pas de valeur en dur).
- **Biblio / Pile** : 2 `StatTile` (Dans la pile · Solde du mois, coloré) + liste des achats non lus
  avec « Je commence ». **Biblio / Tous** : recherche + tri existants (#49), badges d'état.
- **Bilan / Bilan** : nav mois ← → , **score du mois en héros** (52px, italique, dégradé), détail au
  barème en lignes (+vert/−rouge), jauge d'objectif (dégradé), distinctions 🏆💀 avec commentaires,
  CTA « 📋 Copier pour l'antenne » (le geste-livrable, bouton dégradé pleine largeur).
- **Bilan / Stats** : tuiles (pile, finis, pages, note moyenne), **courbe de PAL** (trait dégradé,
  aire violette translucide, point terminal cyan, grille discrète), barres de répartition (une couleur
  de palette par catégorie, stable).
- **Profil** : avatar rond dégradé + initiale, exports, déconnexion (rouge), **crédits CC BY-SA
  intacts** (obligation de licence).
- **Login** : c'est LA page qui peut se permettre le décor complet (logo, confettis, dégradés) —
  à traiter comme l'affiche de l'émission.

## 6. Garde-fous

- **A11y** : contrastes AA sur `--ink`/`--ink2` vs surfaces (vérifier le dégradé sous texte blanc),
  `aria-current="page"` sur l'onglet actif, `aria-pressed` sur segments/chips, focus visible cyan,
  cibles tactiles ≥ 44px. `prefers-reduced-motion` coupe scan-line et confettis.
- **Aucune couleur en dur dans les composants** : tout passe par les tokens (CSS custom properties
  dans `globals.css` + mapping `@theme` Tailwind). La règle « pas de valeur magique » du barème
  s'applique désormais aussi aux couleurs.
- **Le proto ment sur les données** : ses chiffres (points, soldes) sont du décor. L'implémentation
  branche les vrais moteurs (`lib/scoring/`, `lib/stats/`, dérivations PAL/library).
- **Périmètre** : ni le schéma, ni les flux, ni le barème ne bougent. Une seule exception produit :
  les redirections `/pal` et `/stats` (§3).

## 7. Ordre de chantier suggéré

1. **Tokens + composants de base** (`globals.css`, `components/ui/`) — sans toucher aux écrans.
2. **La nav 5 onglets** + redirections + segments.
3. **Rhabillage écran par écran** (Scanner → Journal → Biblio → Bilan → Profil → Login), en
   absorbant à chaque étape les dérivations dupliquées (§3).
4. Confettis & micro-interactions en dernier — la cerise, pas le gâteau.
