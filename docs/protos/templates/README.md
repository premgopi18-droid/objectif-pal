# Templates des cartes de partage (discussion août 2026)

Les 10 fonds candidats pour le partage du bilan en image (format 2:3, 1024×1536,
générés le 21/08/2026). **Ils partagent tous la même grille** — pseudo, rond
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
transfère telle quelle. **Reste à nettoyer à la prochaine passe** :

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
