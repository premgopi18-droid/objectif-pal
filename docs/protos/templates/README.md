# Templates des cartes de partage (discussion août 2026)

Les fonds du partage du bilan en image (format 2:3, 1024×1536 — les 10 premiers
générés le 21/08/2026, `theme_10` le 03/10/2026). **Ils partagent tous la même grille** — pseudo, rond
photo, bloc score du mois, jauges d'objectif (6 catégories), tableau des
catégories avec le barème incrusté et la colonne du milieu vide pour les
compteurs — donc un seul fichier de coordonnées pourra servir tous les thèmes.

| Fichier | Thème |
|---|---|
| `theme_0` | Néon / gaming (violet, dégradé signature) |
| `theme_1` | Dossier confidentiel (kraft, tampons, trombone) |
| `theme_2` | Manga N&B (traits de vitesse, trames) |
| `theme_3` | Grimoire médiéval (dorures, dragon, sceau de cire) |
| `theme_4` | Carnet maudit (encre, bâtons de comptage, empreinte) |
| `theme_5` | Film noir (loupe, impacts de balles) |
| `theme_6` | Romance (roses, ruban, papier délicat) |
| `theme_7` | Sci-fi industriel (métal, hologramme, interrupteurs) |
| `theme_8` | Comics rétro pop (halftone, bulles, étoiles) |
| `theme_9` | Avis de recherche western (bois, corde, étoile de shérif) |
| `theme_10` | Carte au trésor (parchemin, boussole, bannière) |

⚠️ **Pas encore vierges** : `PSEUDO`, `AOÛT 2026`, `+21` et les `0 / 0` des
jauges sont incrustés dans l'image — des valeurs d'exemple, pas des zones
vides. Avant de câbler le rendu, il faudra régénérer ces zones **vides**
(cartouches et jauges sans texte) dans la même session de génération, ou
trancher une stratégie de recouvrement. La colonne des compteurs du tableau,
elle, est déjà vide — prête à recevoir les chiffres.

Les originaux `theme_N` portent le barème incrusté dans la colonne PTS
(+0,5 … −1). **Les vierges ne l'ont plus** (01/10/2026) : la colonne PTS
affiche désormais ce que chaque ligne RAPPORTE, dessiné par l'app (specs
§4.15). Seul le « Bonus +3 » reste incrusté — **à revérifier contre
`lib/scoring/scale.ts` à chaque nouveau thème généré**.

## Fonds vierges (`theme_N_virgin`) — état du 01/09/2026

Première passe de vierges livrée : pseudo, date, score, compteurs et jauges
vidés sur les 10 — la cartographie du proto (calée sur les originaux)
transfère telle quelle. **Reste à nettoyer à la prochaine passe** (✅ fait le
01/10/2026, voir la passe plus bas) :

1. Les six valeurs d'objectif « 0 / 0 » (à droite de Issue/Manga/BD/Comics/
   Omnibus/Roman) — sur les 10 thèmes. Libellés et jauges vides restent.
2. `theme_9` : résidu du « +21 » dans le cartouche score.

⚠️ Régénérer en RETOUCHANT les vierges actuelles (mêmes fonds, 1024×1536,
cadrage identique) — jamais from scratch : le calage au pixel en dépend.

**Correctif appliqué au proto le 01/09/2026** : la date était décentrée dans son
cartouche sur plusieurs thèmes (jusqu'à ~23 px à gauche sur t8). Deux causes :
le letter-spacing traînant (l'espace après le dernier glyphe compte dans la
largeur CSS → décalage de ls/2 sur TOUS les thèmes, désormais compensé par
`margin-right:-ls`) et des `month.x` mal calés. Les `month.x` sont recalibrés
sur les centres de cartouche **mesurés au pixel** dans les fonds vierges
(t0 700, t2 715, t4 711, t5 711, t6 727, t7 700, t8 756, t9 709) — validité
maintenue tant que les retouches gardent le cadrage identique.

**Correctifs de calage notés (à appliquer avec les nouveaux fonds)** :
score t1 rapproché du trait rouge, t3 recentré plus haut, t5 décalé à
gauche, t6 posé sur la ligne ornée au-dessus de « SCORE DU MOIS », t9 sans
jamais sortir du cadre — et test « +102,5 » (3 chiffres) sur les 10, avec
rétrécissement automatique pour ne déborder nulle part.

## Fonds vierges — passe du 01/10/2026

Retouche des vierges précédentes (même cadrage, calage conservé) : les six
« 0 / 0 » des objectifs, le résidu « +21 » de `theme_9` **et la colonne PTS**
sont vidés sur les 10. Différence mesurée avec les fonds de prod : seule la
colonne PTS bouge (et la trame du bloc objectifs de `theme_8`, régénérée à
l'identique : mêmes jauges, mêmes libellés).

**Calage de la colonne PTS** — par superposition, sans passer par le proto :
l'encre de l'ancien barème = |fond de prod − fond vierge|, et un banc
(Edge headless, vrai canvas) cherche police, corps, interlettrage et centre x
qui la recouvrent au mieux (corrélation normalisée, robuste au grain des fonds
texturés), puis échantillonne les encres au cœur des glyphes. Vérifié ensuite
avec le vrai moteur : centre x exact (0-1 px) sur les 10. En y, les points
suivent les lignes des compteurs, qui tombent au centre mesuré des cellules
(0-3 px) — l'ancien barème, lui, dérivait jusqu'à 7 px (t1, t4).

## `theme_10` « Carte au trésor » — 03/10/2026

**Le vierge du repo n'est pas le vierge brut** : `theme_10_virgin.jpeg` est COMPOSÉ —
le modèle (`theme_10.jpeg`) partout, le vierge fourni dans les seules zones de texte
(bannière du pseudo, cartouche mois/score, valeurs d'objectif, colonne PTS), raccords
fondus sur 8 px. Le vierge fourni gardait des résidus des « 0 / 0 » (dont une tache à
côté de Manga), nettoyés par clonage du parchemin voisin (même ligne, à gauche), et sa
retouche avait bavé sur le bout des jauges — le modèle, lui, les a intactes. Contrôle :
zéro pixel différent du modèle hors des zones de texte.

**Calage par superposition** (le banc remplace le proto pour ce thème) : l'encre
d'exemple = |modèle − fond|, ou la clarté seule pour le pseudo (texte crème sur une
bannière dont la texture a été régénérée). Polices criblées sur le catalogue Google
(~1 600 faces), puis départagées au **calque rouge/cyan** — les mesures automatiques
(corrélation, Dice) favorisent les graisses lourdes sur les petits corps flous, l'œil
tranche : Alegreya 900 (pseudo), Literata 800 (score), Literata 700 (le reste).

**Deux réglages nés de ce modèle**, optionnels dans le moteur : `arcRadius` (le pseudo
suit l'arc de la bannière, R ≈ 2 000 px — les extrémités descendent de ~10 px) et
`scaleY` (le « +21 » du modèle est plus haut que Literata à largeur égale : ×1,087,
boîte 609→818 × 389→500 tombée au pixel au vrai moteur).

## Recalage des thèmes 0-9 sur leurs modèles — 03/10/2026

Même méthode que `theme_10`, généralisée : les modèles remplis (`theme_N.jpeg`) et les
vierges sont alignés au pixel (vérifié : hors zones de texte, quelques pixels de grain
seulement), donc l'encre d'exemple de chaque zone = (modèle − vierge).

1. **Encre lue sur le modèle**, jamais sur la calibration en place (parfois fausse :
   Sci-fi et Comics pop avaient l'encre de l'effet, pas celle de la lettre). Couverture
   réelle = projection de (modèle − vierge) sur (encre − vierge), le grain hors de l'axe
   de l'encre ne compte pas ; dégradé de Néon = plusieurs encres relevées par tiers.
2. **Criblage** de tout le catalogue Google (~6 600 faces, italiques comprises) : corps,
   interlettrage et position CALCULÉS par police depuis la boîte d'encre du modèle
   (lettres seules : filets et grain écartés par composantes connexes), puis affinés ;
   mesure = intersection sur union des formes, chaque valeur répétée recalée de ±2 px
   (le modèle généré ne pose pas ses valeurs sur une grille parfaite).
3. **Choix à l'œil** sur planches (modèle + 15 candidates dans l'encre du modèle) : la
   mesure départage les proportions, l'œil la forme (empattements, angles, arrondis).
4. **Vérification au vrai moteur**, carte entière, puis cas lourd (pseudo long, +172,5).

Les compteurs n'ont aucun exemple dans les modèles (colonne vide) : ils suivent la
police de la colonne PTS. Deux réglages de la colonne PTS en naissent : `align`
(Dossier aligne à gauche) et `dy`. Arbitrages assumés : Carnet garde Special Elite
pour ses points (les taches faussent la mesure) ; le mois de Dossier est en Courier
Prime normal (le modèle est une machine à écrire fine).
