// Types partagés de la table de jeu (état diffusé par La Fripouille, déjà filtré par rôle).
import type { Son } from "@/lib/ambiance-sonore";
import type { DeTire } from "@/lib/des3d";

export type TypePion = "joueur" | "monstre" | "pnj";
export type Role = "admin" | "mj" | "joueur";

export type Pion = {
  id: string; nom: string; type: TypePion; couleur: string; taille: number; x: number; y: number;
  pv: number | null; pv_max: number | null; image_url: string; cache: boolean; etats: string[];
  icone?: string; proprio?: string;
};
export type Jet = {
  id: string; qui: string; uid?: string; raison: string; expr: string; brut?: string; critique?: boolean;
  total: number | null; nat: number | null; lignes: string[]; des: DeTire[]; cache: boolean; heure: number;
};
export type EntreeInit = { cle: string; uid: string; nom: string; total: number; d20: number; bonus: number; pion_id: string };
export type Initiative = { actif: boolean; round: number; tour: number; entrees: EntreeInit[]; courant: string | null };
export type Affiche = { id: string; titre: string; texte: string; image_url: string } | null;
export type MembreAcces = { id: string; nom: string; role: Role };

export type Etat = {
  version: number;
  carte: { image_url: string; cols: number; rows: number; quadrillage: boolean };
  pions: Pion[];
  brouillard: { actif: boolean; reveles: number[][] };
  fil: Jet[];
  scene?: { id: string; nom: string; lumieres: number[][] };
  ambiance?: { lumiere: "jour" | "crepuscule" | "nuit"; meteo: string; son: Son };
  initiative?: Initiative;
  affiche?: Affiche;
  // MJ seulement (absents de la vue joueur)
  mj?: { aventure_id: string; etape_id: string };
  acces?: MembreAcces[];
};

export type Moi = { acteur: string; role: Role; uid: string };
export type Present = { acteur: string; role: Role; uid: string };

export type Document = { id: string; titre: string; texte: string; image_url: string };
export type Etape = {
  id: string; titre: string; texte: string; notes: string; documents: Document[]; fait: boolean;
  photo: { prise: number; scene?: { nom: string }; pions?: unknown[] } | null;
};
export type Aventure = { id: string; titre: string; resume: string; etapes: Etape[] };

export type Op = (corps: Record<string, unknown>) => Promise<Record<string, unknown> | null>;

export const estMJ = (m: Moi | null) => m?.role === "admin" || m?.role === "mj";
