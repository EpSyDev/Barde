import type { IconName } from "@/components/Icon";

export type Section = {
  id: string;
  label: string;
  icon: IconName;
  hint: string;
  group: string;
  ready: boolean;
  /** Titre de l'en-tête quand il diffère du libellé du menu. */
  titre?: string;
};

// Le menu est rangé par intention, pas par ordre d'arrivée des features : on cherche
// « où je règle les écus », pas « quel module a été codé en troisième ».
// Déclaré ici, hors composant, pour que la palette y accède sans import circulaire.
export const SECTIONS: Section[] = [
  { id: "accueil", label: "La Taverne", icon: "maison", hint: "Vue d'ensemble", group: "Salle commune", ready: true, titre: "La Taverne ce soir" },
  { id: "bardes", label: "Bardes", icon: "luth", hint: "Régie musicale", group: "Salle commune", ready: true, titre: "Régie des Bardes" },

  { id: "communaute", label: "Communauté", icon: "blason", hint: "Rôles & accueil", group: "Les habitants", ready: true },
  { id: "membres", label: "Membres", icon: "personnes", hint: "Fiche d'un habitant", group: "Les habitants", ready: true },
  { id: "jeux", label: "Rôles-jeux", icon: "manette", hint: "Menu des jeux", group: "Les habitants", ready: true },
  { id: "messages", label: "Messages", icon: "plume", hint: "Envois & récurrents", group: "Les habitants", ready: true },
  { id: "vocaux", label: "Salons vocaux", icon: "cor", hint: "Vocaux temporaires", group: "Les habitants", ready: true },

  { id: "economie", label: "Économie", icon: "bourse", hint: "Monnaie & boutique", group: "Écus & rites", ready: true },
  { id: "tresorerie", label: "Trésorerie", icon: "coffre", hint: "Masse, flux, écarts", group: "Écus & rites", ready: true },
  { id: "bapteme", label: "Baptême", icon: "chandelle", hint: "Générateur de noms", group: "Écus & rites", ready: true },
  { id: "registre", label: "Registre", icon: "parchemin", hint: "Baptisés", group: "Écus & rites", ready: true },

  { id: "moderation", label: "Modération", icon: "balance", hint: "Sanctions & escalade", group: "L'ordre", ready: true },
  { id: "tickets", label: "Tickets", icon: "ticket", hint: "Support membres", group: "L'ordre", ready: true },
  { id: "journal", label: "Journal", icon: "registre", hint: "Tout ce qui s'est passé", group: "L'ordre", ready: true },

  { id: "media", label: "Média", icon: "cadre", hint: "Images des embeds", group: "L'atelier", ready: true },
  { id: "reglages", label: "Réglages", icon: "engrenage", hint: "Sauvegarde & audit", group: "L'atelier", ready: true },
  { id: "taverniers", label: "Taverniers", icon: "capuche", hint: "PNJ & ambiance", group: "L'atelier", ready: false },
];

export const SECTION_DEFAUT = "accueil";
