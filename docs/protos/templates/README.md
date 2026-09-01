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

Le barème incrusté (PTS) correspond à `lib/scoring/scale.ts` : issue +0,5,
manga +1, BD +2, comics +3, omnibus +5, roman +5, titre acheté non lu −1,
bonus objectif +3. **À revérifier à chaque nouveau thème généré** — un barème
qui divergerait mentirait à l'antenne.
