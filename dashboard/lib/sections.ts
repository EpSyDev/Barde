import type { IconName } from "@/components/Icon";

// Le menu est rangé en QUARTIERS, par intention (« je viens faire jouer les gens »,
// « je viens régler un conflit »), jamais par ordre d'arrivée des features. Chaque
// quartier a son blason : émail, partition héraldique, meuble — et sa couleur suit
// l'utilisateur jusque dans la page (fil d'Ariane, sceau, liseré).
// Déclaré ici, hors composant, pour que la palette y accède sans import circulaire.

export type QuartierId = "salle" | "jeu" | "table" | "place" | "ecus" | "ordre" | "atelier";
/** Partitions héraldiques dessinées dans l'écu (components/Blason.tsx). */
export type Partition = "bordure" | "parti" | "ecartele" | "chevron" | "besants" | "bande" | "fasce";
/** Hachures de Petra Sancta : la convention de gravure qui code chaque émail. */
export type Hachure = "or" | "gueules" | "azur" | "sinople" | "pourpre" | "sable";

export type Quartier = {
  id: QuartierId;
  nom: string;
  devise: string;
  /** émail du champ, sa teinte sombre, l'émail de la pièce (partition) */
  couleur: string;
  fonce: string;
  piece: string;
  partition: Partition;
  hachure: Hachure;
  meuble: IconName;
  /** Métal ou émail du meuble (règle : pas de métal sur métal). */
  teinte: "or" | "argent" | "sable" | "gueules";
};

export const QUARTIERS: Quartier[] = [
  { id: "salle", nom: "Salle commune", devise: "Le cœur de la taverne", couleur: "#c08a2c", fonce: "#7a5214", piece: "#9b2418", partition: "bordure", hachure: "or", meuble: "flamme", teinte: "gueules" },
  { id: "jeu", nom: "Le Jeu", devise: "Faire jouer les gens ensemble", couleur: "#3f8f5c", fonce: "#1f5634", piece: "#d6b25a", partition: "parti", hachure: "sinople", meuble: "manette", teinte: "argent" },
  { id: "table", nom: "La Table", devise: "Donjons & Dragons", couleur: "#7b4fb3", fonce: "#46276f", piece: "#ece4d2", partition: "ecartele", hachure: "pourpre", meuble: "de", teinte: "or" },
  { id: "place", nom: "La Place", devise: "Parler à la communauté", couleur: "#2f6fb3", fonce: "#173f6e", piece: "#ece4d2", partition: "chevron", hachure: "azur", meuble: "cor", teinte: "or" },
  { id: "ecus", nom: "Écus & rites", devise: "L'économie et le rôle", couleur: "#b8902f", fonce: "#6e5416", piece: "#5a3a12", partition: "besants", hachure: "or", meuble: "bourse", teinte: "sable" },
  { id: "ordre", nom: "L'Ordre", devise: "Protéger et rendre justice", couleur: "#b3392a", fonce: "#6b1a10", piece: "#ece4d2", partition: "bande", hachure: "gueules", meuble: "epees", teinte: "or" },
  { id: "atelier", nom: "L'Atelier", devise: "Les coulisses de la taverne", couleur: "#5f6f7c", fonce: "#333d45", piece: "#a9b6c0", partition: "fasce", hachure: "sable", meuble: "marteau", teinte: "or" },
];

export type Section = {
  id: string;
  label: string;
  icon: IconName;
  hint: string;
  quartier: QuartierId;
  /** Nom du quartier (lu par la palette ⌘K pour grouper les résultats). */
  group: string;
  ready: boolean;
  /** Titre de l'en-tête quand il diffère du libellé du menu. */
  titre?: string;
  /** Onglet qui mène à une autre page du site (ex. la table de jeu). */
  lien?: string;
};

type Def = Omit<Section, "group">;
const DEFS: Def[] = [
  { id: "accueil", label: "La Taverne", icon: "maison", hint: "Vue d'ensemble", quartier: "salle", ready: true, titre: "La Taverne ce soir" },
  { id: "bardes", label: "Bardes", icon: "luth", hint: "Régie musicale", quartier: "salle", ready: true, titre: "Régie des Bardes" },

  { id: "jeux", label: "Rôles-jeux", icon: "manette", hint: "Menu des jeux", quartier: "jeu", ready: true },
  { id: "viejeux", label: "Vie des jeux", icon: "pousse", hint: "Suggestion, accueil, partenaires", quartier: "jeu", ready: true, titre: "Faire vivre les jeux" },
  { id: "enligne", label: "En ligne", icon: "signal", hint: "Jeux lancés en direct", quartier: "jeu", ready: true, titre: "Qui est en ligne" },
  { id: "soirees", label: "Soirées", icon: "calendrier", hint: "Inscriptions & rappels", quartier: "jeu", ready: true, titre: "Soirées jeu" },
  { id: "sondages", label: "Sondages", icon: "urne", hint: "Vote → soirée", quartier: "jeu", ready: true },
  { id: "ombres", label: "Les Ombres", icon: "capuche", hint: "Loup-garou de la taverne", quartier: "jeu", ready: true, lien: "/ombres" },
  { id: "flotte", label: "Flottes Royales", icon: "ancre", hint: "Bataille navale multijoueur", quartier: "jeu", ready: true, lien: "/flotte" },
  { id: "diffusions", label: "Diffusions", icon: "ecran", hint: "Lives Twitch & YouTube", quartier: "jeu", ready: true },

  { id: "table", label: "Table de jeu", icon: "carte", hint: "Plateau, dés 3D, carnet du MJ", quartier: "table", ready: true, lien: "/table" },
  { id: "des", label: "Dés", icon: "de", hint: "Panneau Discord & initiative", quartier: "table", ready: true, titre: "Table de dés" },

  { id: "communaute", label: "Communauté", icon: "blason", hint: "Rôles & accueil", quartier: "place", ready: true },
  { id: "membres", label: "Membres", icon: "personnes", hint: "Fiche d'un habitant", quartier: "place", ready: true },
  { id: "messages", label: "Messages", icon: "plume", hint: "Envois & récurrents", quartier: "place", ready: true },
  { id: "vocaux", label: "Salons vocaux", icon: "micro", hint: "Vocaux temporaires", quartier: "place", ready: true },
  { id: "chronique", label: "Chronique", icon: "parchemin", hint: "Récap de la semaine", quartier: "place", ready: true, titre: "La chronique" },

  { id: "economie", label: "Économie", icon: "bourse", hint: "Monnaie & boutique", quartier: "ecus", ready: true },
  { id: "tresorerie", label: "Trésorerie", icon: "coffre", hint: "Masse, flux, écarts", quartier: "ecus", ready: true },
  { id: "bapteme", label: "Baptême", icon: "chandelle", hint: "Générateur de noms", quartier: "ecus", ready: true },
  { id: "registre", label: "Registre", icon: "registre", hint: "Baptisés", quartier: "ecus", ready: true },

  { id: "moderation", label: "Modération", icon: "balance", hint: "Sanctions & escalade", quartier: "ordre", ready: true },
  { id: "garde", label: "Garde", icon: "bouclier", hint: "Anti-raid & verrouillage", quartier: "ordre", ready: true, titre: "La Garde" },
  { id: "tickets", label: "Tickets", icon: "ticket", hint: "Support membres", quartier: "ordre", ready: true },
  { id: "taches", label: "Tâches", icon: "liste", hint: "To-do de l'équipe", quartier: "ordre", ready: true, titre: "Tâches de l'équipe" },
  { id: "journal", label: "Journal", icon: "clepsydre", hint: "Tout ce qui s'est passé", quartier: "ordre", ready: true },

  { id: "stats", label: "Statistiques", icon: "graphique", hint: "Arrivées, activité, jeux", quartier: "atelier", ready: true, titre: "Statistiques du serveur" },
  { id: "sante", label: "Santé & sauvegarde", icon: "coeur", hint: "VM, alertes, copies", quartier: "atelier", ready: true, titre: "Santé de la VM & sauvegarde" },
  { id: "acces", label: "Accès", icon: "cle", hint: "Admins, MJ & joueurs", quartier: "atelier", ready: true, titre: "Accès & rôles" },
  { id: "media", label: "Média", icon: "cadre", hint: "Images des embeds", quartier: "atelier", ready: true },
  { id: "reglages", label: "Réglages", icon: "engrenage", hint: "Audit & paramètres", quartier: "atelier", ready: true },
  { id: "taverniers", label: "Taverniers", icon: "capuche", hint: "PNJ & ambiance", quartier: "atelier", ready: false },
];

export const SECTIONS: Section[] = DEFS.map((s) => ({ ...s, group: QUARTIERS.find((q) => q.id === s.quartier)!.nom }));

export const quartierDe = (sectionId: string): Quartier =>
  QUARTIERS.find((q) => q.id === SECTIONS.find((s) => s.id === sectionId)?.quartier) ?? QUARTIERS[0];

export const SECTION_DEFAUT = "accueil";
