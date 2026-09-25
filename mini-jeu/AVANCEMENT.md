# L'Oreille de Myrhaven — mini-jeu

Jeu de gestion de comptoir, 100 % navigateur, sans backend (sauvegarde localStorage + code d'export
dans « Registre »). Ce n'est pas un point & click, et il n'y a pas d'hydre (l'ARG est abandonné).
Canon = `MYRHAVEN POINT AND CLIK/docs/lore-myrhaven.md` (le [établi] seulement).

**Jouer :** https://claude.ai/artifact/837E7tKyCAs9ArGTWKKup1 (privé, partage depuis le menu Share).
Pour republier : republier `oreille/index.html` avec ses fichiers (style.css, data.js, game.js, assets/).

## Boucles
- **Salle** : voyageurs aux tables, commande explicite ou devinette (bulle mauve, à partir de la
  renommée 2). Le bon verre sur devinette = pourboire doublé et plus de chances d'obtenir une rumeur.
- **Cave** : tonneaux brassés en temps réel (1 min pour la blonde, 8 h pour la liqueur de brume).
- **Marché** : orge et houblon illimités ; le reste arrive toutes les 3 h, en quantité limitée.
- **Carte des rumeurs** : 3 rumeurs par contrée lèvent la brume. La 3ᵉ ne tombe que sur une
  devinette trouvée. Chaque contrée levée ouvre ses voisines (renommée requise).
- **Rendez-vous** : l'ardoise du jour (3 tâches + coffret + série de jours), la Fripouille
  (3 paris aux dés par jour ; son dé à 7 se dénonce), les musiciens (20 min de bonus), les
  visiteurs selon l'heure réelle (vampires de 20 h à 6 h, nains le matin, loups la nuit…),
  le vieil homme (dès 8 contrées levées, surtout la nuit).
- **Absence** : le tavernier sert ce qu'il reste au comptoir (jusqu'à 8 h, 14 h avec les
  chambres), mais il ne recueille aucune rumeur.

## Fichiers
`oreille/data.js` = tout le contenu et l'équilibrage (textes, prix, durées). `oreille/game.js` =
le moteur (tick d'une seconde, suspendu quand l'onglet est caché). Les décors et portraits viennent
de MYRHAVEN, convertis en webp.
