// Les Ombres de la Taverne — données partagées du front (l'état arrive déjà filtré par
// La Fripouille : ce fichier ne contient que des libellés, jamais de secrets).

export type RoleId =
  | "habitue" | "inquisiteur" | "alchimiste" | "paladin" | "videur" | "tavernier"
  | "cultiste" | "voix" | "barde" | "ragequit";
export type Camp = "taverne" | "ombres" | "barde" | "ragequit";
export type Phase = "hall" | "distribution" | "nuit" | "alchimie" | "aube" | "videur" | "debat" | "conseil" | "verdict" | "fin";
export type CarteId = "pleine_lune" | "tempete" | "brouillard" | "lanterne" | "rumeur" | "biere" | "couvre_feu" | "bulletins" | "calme";

export type Joueur = {
  uid: string; nom: string; avatar: string; pantin: boolean; vivant: boolean;
  mort: { jour: number; cause: string } | null;
  role: RoleId | null; camp: Camp | null; enchante: boolean | null; testament: string | null;
};
export type Info = { t: number; nuit: number; jour: number; texte: string; nature: string };
export type Entree = { id: string; t: number; type: "recit" | "secret" | "vote" | "mort" | "testament" | "evenement" | "fin"; texte: string; pour: unknown; jour: number; uid?: string; role?: RoleId; carte?: CarteId; aube?: boolean };
export type Murmure = { uid: string; nom: string; texte: string; t: number };
export type Perso = {
  role: RoleId; camp: Camp; vivant: boolean; infos: Info[]; enchante: boolean;
  action?: { cibles?: string[]; passe?: boolean; convertir?: boolean } | null;
  votes_ombres?: Record<string, string>;
  alchimie?: { cibles: string[]; brouillard: boolean; fait: boolean; vie: string; mort: string };
  memo?: { fiole_vie?: boolean; fiole_mort?: boolean; dernier?: string; utilisee?: boolean };
  conciliabule?: Murmure[];
  mon_vote?: string | null;
};
export type Options = { evenements: boolean; retraits: string[]; nuit: number; debat: number; conseil: number };
export type Partie = {
  id: string; phase: Phase; jour: number; nuit: number; mode: "auto" | "mj"; mj: string; hote: string;
  options: Options; echeance: number | null; pause: number | null; debut: number | null; maintenant: number;
  joueurs: Joueur[]; moi: string | null; est_mj: boolean; evenement: CarteId | null; muet: string;
  votes: { secret: boolean; exprimes: number; liste: Record<string, string>; decompte: Record<string, number> } | null;
  pret_vote: number;
  verdict: { chasse: string; voix: number; egalite: boolean } | null;
  videur: string | null;
  aube: { proclamee: boolean; texte: string; morts: string[]; carte: CarteId | null } | null;
  ames: { cartes: CarteId[]; compte: Record<string, number>; mon_vote: string | null } | null;
  nuit_publique: { eveilles: number } | null;
  perso: Perso | null;
  secrets: {
    actions: Record<string, { cibles?: string[]; passe?: boolean; convertir?: boolean }>;
    votes_ombres: Record<string, string>; cibles: string[]; bloque: string;
    alchimie: { vie?: string; mort?: string; fait?: boolean } | null;
    memo: { paladin_dernier: string; tavernier_dernier: string; fiole_vie: boolean; fiole_mort: boolean; voix_utilisee: boolean; ragequit_gagnant: string };
    aube_morts: { uid: string; cause: string }[]; aube_brouillon: string;
  } | null;
  journal: Entree[];
  fin: { vainqueur: Camp | "personne" | "annulee"; titre: string; gagnants: string[]; raison: string } | null;
  composition: RoleId[] | null;
};
export type Vue = {
  type: "etat"; presents: number; partie: Partie | null; maintenant?: number; cle_scene?: string;
  peut: { ouvrir: boolean; ouvrir_mj: boolean; pantins: boolean; arbitre: boolean };
  moi: { uid: string; nom: string; role: string };
};

export const CAMPS: Record<Camp, { nom: string; couleur: string; fonce: string }> = {
  taverne: { nom: "La Taverne", couleur: "#d9b45a", fonce: "#5a3d12" },
  ombres: { nom: "Les Ombres", couleur: "#a77bff", fonce: "#2a1650" },
  barde: { nom: "Solitaire", couleur: "#5fbf86", fonce: "#173d28" },
  ragequit: { nom: "Solitaire", couleur: "#e2714f", fonce: "#4a1a0e" },
};

export const ROLES: Record<RoleId, { nom: string; court: string; camp: Camp; devise: string; pouvoir: string; nuit: boolean }> = {
  habitue: { nom: "L'Habitué", court: "Habitué", camp: "taverne", nuit: false,
    devise: "« Une chope, un tabouret, et l'œil qui traîne. »",
    pouvoir: "Aucun pouvoir, sauf le plus redoutable : ta voix au Conseil et ton flair." },
  inquisiteur: { nom: "L'Inquisiteur", court: "Inquisiteur", camp: "taverne", nuit: true,
    devise: "« Toute âme a une couleur. »",
    pouvoir: "Chaque nuit, sonde une âme : tu apprends si elle sert la Taverne, les Ombres, ou elle seule." },
  alchimiste: { nom: "L'Alchimiste", court: "Alchimiste", camp: "taverne", nuit: true,
    devise: "« Une goutte sauve, une goutte achève. »",
    pouvoir: "Tu vois la victime des Ombres. Une fiole de vie pour la sauver, une fiole de mort pour qui tu veux — une seule fois chacune." },
  paladin: { nom: "Le Paladin", court: "Paladin", camp: "taverne", nuit: true,
    devise: "« Derrière mon bouclier, nul ne tombe. »",
    pouvoir: "Chaque nuit, protège une âme (toi compris) des Ombres. Jamais deux nuits de suite la même. Ne protège pas du poison." },
  videur: { nom: "Le Videur", court: "Videur", camp: "taverne", nuit: false,
    devise: "« Si je sors, tu sors avec moi. »",
    pouvoir: "Quand tu tombes, tu empoignes un convive et le jettes dehors avec toi." },
  tavernier: { nom: "Le Tavernier", court: "Tavernier", camp: "taverne", nuit: true,
    devise: "« C'est ma tournée — et tu vas dormir. »",
    pouvoir: "Chaque nuit, sers une tournée : ta cible ne peut pas agir, et tu apprends si elle était éveillée (si elle a un pouvoir de nuit). Pas deux nuits de suite la même." },
  cultiste: { nom: "Le Cultiste de l'Ombre", court: "Cultiste", camp: "ombres", nuit: true,
    devise: "« La chandelle s'éteint. Nous, jamais. »",
    pouvoir: "Chaque nuit, avec tes frères, désigne une victime. Murmurez entre vous dans le conciliabule. Le jour, mens." },
  voix: { nom: "La Voix de l'Ombre", court: "Voix", camp: "ombres", nuit: true,
    devise: "« Écoute… et rejoins-nous. »",
    pouvoir: "Tu chasses avec les Ombres. Une fois par partie, ta victime n'est pas tuée : elle est convertie et devient Cultiste." },
  barde: { nom: "Le Barde", court: "Barde", camp: "barde", nuit: true,
    devise: "« Toute la salle finira par chanter mon air. »",
    pouvoir: "Chaque nuit, enchante deux âmes. Les enchantés se reconnaissent. Si tous les vivants sont sous ton charme, tu gagnes seul." },
  ragequit: { nom: "Le Ragequit", court: "Ragequit", camp: "ragequit", nuit: false,
    devise: "« De toute façon ce jeu est truqué. »",
    pouvoir: "Fais-toi chasser par le Conseil du premier jour : tu claques la porte et tu gagnes. Sinon, tu boudes et deviens simple Habitué." },
};

export const ORDRE_ROLES: RoleId[] = ["habitue", "inquisiteur", "alchimiste", "paladin", "videur", "tavernier", "cultiste", "voix", "barde", "ragequit"];
export const RETIRABLES: RoleId[] = ["inquisiteur", "alchimiste", "paladin", "videur", "ragequit", "tavernier", "barde", "voix"];

export const CARTES: Record<CarteId, { nom: string; texte: string; faveur: "ombres" | "taverne" | "neutre" }> = {
  pleine_lune: { nom: "Pleine Lune", texte: "La nuit prochaine, les Ombres frappent deux fois.", faveur: "ombres" },
  tempete: { nom: "Tempête magique", texte: "La nuit prochaine, le bouclier du Paladin ne protège personne.", faveur: "ombres" },
  brouillard: { nom: "Brouillard des marais", texte: "La nuit prochaine, l'Alchimiste ne voit pas la victime des Ombres.", faveur: "ombres" },
  lanterne: { nom: "Lanterne sourde", texte: "La nuit prochaine, l'Inquisiteur sonde deux âmes.", faveur: "taverne" },
  rumeur: { nom: "Rumeur de comptoir", texte: "Un convive qui n'est pas une Ombre est innocenté devant tous.", faveur: "taverne" },
  biere: { nom: "Bière frelatée", texte: "Un convive tiré au sort perd sa voix au Conseil d'aujourd'hui.", faveur: "neutre" },
  couvre_feu: { nom: "Couvre-feu", texte: "Le débat d'aujourd'hui est deux fois plus court.", faveur: "neutre" },
  bulletins: { nom: "Bulletins cachetés", texte: "Le vote du Conseil reste secret jusqu'au dépouillement.", faveur: "neutre" },
  calme: { nom: "Nuit sans lune", texte: "Rien d'étrange… pour l'instant.", faveur: "neutre" },
};

export const PHASES: Record<Phase, { titre: string; sous: string; nuit: boolean }> = {
  hall: { titre: "La salle se remplit", sous: "Prenez place autour de la table", nuit: false },
  distribution: { titre: "Les cartes sont distribuées", sous: "Découvre ton rôle, en secret", nuit: true },
  nuit: { titre: "La nuit tombe", sous: "Les Ombres rôdent…", nuit: true },
  alchimie: { titre: "Une fiole tinte", sous: "L'Alchimiste veille encore", nuit: true },
  aube: { titre: "L'aube se lève", sous: "On compte les têtes", nuit: false },
  videur: { titre: "Le Videur se relève", sous: "Qui jettera-t-il dehors ?", nuit: false },
  debat: { titre: "Le débat", sous: "Accusez, défendez-vous, mentez", nuit: false },
  conseil: { titre: "Le Conseil", sous: "Désignez un suspect", nuit: false },
  verdict: { titre: "Le verdict", sous: "Le Conseil a parlé", nuit: false },
  fin: { titre: "Fin de partie", sous: "Les masques tombent", nuit: false },
};

export const CAUSES: Record<string, string> = {
  ombres: "dévoré par les Ombres", fiole: "empoisonné", videur: "emporté par le Videur",
  conseil: "chassé par le Conseil", exclu: "a quitté la table",
};

export function initiales(nom: string) {
  return nom.split(/\s+/).filter(Boolean).slice(0, 2).map((m) => m[0]).join("").toUpperCase() || "?";
}

/** Teinte stable par joueur (médaillons sans avatar). */
export function teinte(uid: string) {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) % 360;
  return `hsl(${h} 32% 34%)`;
}
