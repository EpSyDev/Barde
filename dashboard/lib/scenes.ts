// Scènes prêtes à jouer, bestiaire et classes de héros du plateau de jeu.
// Les cartes sont générées par dashboard/scripts/cartes.py (96 px par case) ; les
// coordonnées (lumières du décor) sont en cases.

export type Lumiere = "jour" | "crepuscule" | "nuit";
export type Meteo = "aucune" | "pluie" | "neige" | "brume" | "braises";
export type SonScene = "aucun" | "taverne" | "crypte" | "foret" | "camp" | "pluie";

export type Scene = {
  id: string;
  nom: string;
  accroche: string;
  image_url: string;
  cols: number;
  rows: number;
  lumieres: [number, number, number][]; // [x, y, rayon] en cases
  entree?: [number, number]; // où arrivent les héros
  ambiance: { lumiere: Lumiere; meteo: Meteo; son: SonScene };
  brouillard?: boolean;
  bestiaire: string[]; // ids suggérés en premier
};

export const SCENES: Scene[] = [
  {
    id: "taverne",
    nom: "La Taverne du Pendu",
    accroche: "Un soir de pluie, le feu crépite et un inconnu attend au fond de la salle.",
    image_url: "/cartes/taverne.webp",
    cols: 24,
    rows: 16,
    entree: [11, 13],
    lumieres: [[21.9, 8, 6.5], [1.3, 6, 3.2], [1.3, 10, 3.2], [8, 14.6, 3.2], [16, 14.6, 3.2],
      [5.2, 7.3, 2], [8.7, 10.3, 2], [13.2, 6.8, 2], [13.7, 11.3, 2], [18.2, 7.8, 2], [18.7, 12.6, 1.8], [4.7, 11.8, 1.8]],
    ambiance: { lumiere: "crepuscule", meteo: "aucune", son: "taverne" },
    bestiaire: ["bandit", "cultiste", "rat"],
  },
  {
    id: "crypte",
    nom: "La Crypte oubliée",
    accroche: "Sous le vieux temple, des braseros brûlent encore. Quelqu'un les entretient.",
    image_url: "/cartes/crypte.webp",
    cols: 24,
    rows: 16,
    entree: [2, 7],
    lumieres: [[4, 7.5, 4.5], [13, 7.5, 4.5], [19.5, 4.5, 3]],
    ambiance: { lumiere: "nuit", meteo: "aucune", son: "crypte" },
    brouillard: true,
    bestiaire: ["squelette", "zombie", "goule", "chauvesouris"],
  },
  {
    id: "clairiere",
    nom: "La Clairière des Murmures",
    accroche: "Un cercle de pierres levées, un ruisseau, et des yeux qui brillent entre les arbres.",
    image_url: "/cartes/clairiere.webp",
    cols: 26,
    rows: 18,
    entree: [1, 10],
    lumieres: [[16, 6, 3]],
    ambiance: { lumiere: "jour", meteo: "aucune", son: "foret" },
    bestiaire: ["loup", "araignee", "ours", "gobelin"],
  },
  {
    id: "camp",
    nom: "Le Camp sur la route",
    accroche: "La caravane a dressé le camp. Au-delà du feu, la nuit n'est pas tout à fait silencieuse.",
    image_url: "/cartes/camp.webp",
    cols: 24,
    rows: 16,
    entree: [1, 6],
    lumieres: [[12, 11.5, 6.5]],
    ambiance: { lumiere: "nuit", meteo: "braises", son: "camp" },
    bestiaire: ["bandit", "gobelin", "orc", "ogre"],
  },
  {
    id: "vierge",
    nom: "Carte vierge",
    accroche: "Des dalles et un quadrillage : pour improviser, ou charger ta propre carte.",
    image_url: "",
    cols: 24,
    rows: 16,
    lumieres: [],
    ambiance: { lumiere: "jour", meteo: "aucune", son: "aucun" },
    bestiaire: [],
  },
];

export type Creature = { id: string; nom: string; icone: string; pv: number; taille: number; couleur: string };

// PV moyens et tailles du SRD 5e (contenu libre) : M = 1 case, G = 2×2, TG = 3×3.
export const BESTIAIRE: Creature[] = [
  { id: "rat", nom: "Rat géant", icone: "🐀", pv: 7, taille: 1, couleur: "#7a6a58" },
  { id: "kobold", nom: "Kobold", icone: "🦎", pv: 5, taille: 1, couleur: "#a0623a" },
  { id: "gobelin", nom: "Gobelin", icone: "👺", pv: 7, taille: 1, couleur: "#6f8a3a" },
  { id: "bandit", nom: "Bandit", icone: "🗡️", pv: 11, taille: 1, couleur: "#7d4b3a" },
  { id: "cultiste", nom: "Cultiste", icone: "🕯️", pv: 9, taille: 1, couleur: "#5c3a6e" },
  { id: "squelette", nom: "Squelette", icone: "💀", pv: 13, taille: 1, couleur: "#b8ad96" },
  { id: "zombie", nom: "Zombie", icone: "🧟", pv: 22, taille: 1, couleur: "#5f7550" },
  { id: "goule", nom: "Goule", icone: "👻", pv: 22, taille: 1, couleur: "#6b6f7a" },
  { id: "loup", nom: "Loup", icone: "🐺", pv: 11, taille: 1, couleur: "#6e6a66" },
  { id: "chauvesouris", nom: "Chauve-souris géante", icone: "🦇", pv: 22, taille: 2, couleur: "#3e3446" },
  { id: "orc", nom: "Orc", icone: "👹", pv: 15, taille: 1, couleur: "#55703c" },
  { id: "hobgobelin", nom: "Hobgobelin", icone: "🪖", pv: 11, taille: 1, couleur: "#9a4a2c" },
  { id: "araignee", nom: "Araignée géante", icone: "🕷️", pv: 26, taille: 2, couleur: "#2f2a2a" },
  { id: "ours", nom: "Ours brun", icone: "🐻", pv: 34, taille: 2, couleur: "#6b4a2e" },
  { id: "ogre", nom: "Ogre", icone: "🪓", pv: 59, taille: 2, couleur: "#8a6a3e" },
  { id: "troll", nom: "Troll", icone: "🧌", pv: 84, taille: 2, couleur: "#4e6b46" },
  { id: "dragon", nom: "Jeune dragon rouge", icone: "🐉", pv: 178, taille: 2, couleur: "#a8261c" },
];

export type Classe = { nom: string; icone: string };
export const CLASSES: Classe[] = [
  { nom: "Barbare", icone: "🪓" }, { nom: "Barde", icone: "🎻" }, { nom: "Clerc", icone: "✨" },
  { nom: "Druide", icone: "🌿" }, { nom: "Ensorceleur", icone: "🔥" }, { nom: "Guerrier", icone: "⚔️" },
  { nom: "Magicien", icone: "🔮" }, { nom: "Moine", icone: "👊" }, { nom: "Occultiste", icone: "👁️" },
  { nom: "Paladin", icone: "🛡️" }, { nom: "Rôdeur", icone: "🏹" }, { nom: "Roublard", icone: "🗝️" },
];

// Une couleur par héros (lisibles sur toutes les cartes).
export const COULEURS_HEROS = ["#4f7fbf", "#3f9f8f", "#9f6fcf", "#cf8f3f", "#cf5f8f", "#5faf4f"];
