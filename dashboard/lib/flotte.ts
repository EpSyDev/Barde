// Guerre des Flottes Royales — données et géométrie partagées du front.
//
// La vérité est sur le serveur (fripouille/modules/flotte_regles.py) : tout ce qui est ici
// sert à AFFICHER et à AIDER à planifier (cases atteignables, chance de toucher), avec les
// constantes reçues dans la vue (`regles`). Le serveur revalide chaque ordre.

export type Cell = [number, number];
export type Classe = "eclaireur" | "fregate" | "siege";
export type Temps = "calme" | "brise" | "vent_fort" | "brouillard" | "tempete";
export type PavillonId = "lion" | "kraken" | "corbeau" | "rose" | "loup" | "soleil" | "ancre" | "dragon";
export type Phase = "salon" | "preparation" | "planification" | "resolution" | "fin";

export type Navire = {
  id: string; uid: string; classe: Classe; nom: string; pos: Cell; cap: number;
  coque: number; max: number; coule?: number | null;
};
export type Fantome = { id: string; uid: string; classe: Classe; nom: string; pos: Cell; manche: number };
export type Action = { type: "garde" } | { type: "tir"; cible: string };
export type Ordre = { chemin: Cell[]; action: Action };
export type Joueur = {
  uid: string; nom: string; avatar: string; bot: boolean; pavillon: PavillonId; pret: boolean;
  verrou: boolean; elimine: number | null; abandon: boolean; navires: number;
};
export type Meteo = { temps: Temps; vent: number };
export type Carte = { l: number; h: number; terrain: string[]; departs: Cell[]; ports: Cell[] };
export type Stats = { tirs: number; touches: number; degats: number; coules: number; perdus: number };
export type Classement = Stats & {
  uid: string; rang: number; navires: number; coque: number; precision: number | null;
  elimine: number | null; abandon: boolean;
};
export type Fin = {
  gagnants: string[]; raison: "derniere_flotte" | "limite" | "aneantissement" | "anticipee";
  manches: number; duree: number; classement: Classement[];
};
export type Cible = { id: string; distance: number; possible: boolean; raison: string; chance: number };

export type Evt =
  | { t: "mouv"; id: string; chemin: Cell[]; cap: number | null; debut_vu?: boolean; fin_vue?: boolean }
  | { t: "choc"; ids: string[]; pos: Cell; degats: Record<string, number> }
  | { t: "recif"; id: string; pos: Cell; degats: number }
  | { t: "reparation"; id: string; pos: Cell }
  | { t: "tir_annule"; id: string; cible: string; raison: string }
  | { t: "tir"; de: string | null; vers: string | null; pos_de: Cell | null; pos_vers: Cell | null;
      chance: number | null; touche: boolean | null; critique: boolean | null; degats: number | null }
  | { t: "coule"; id: string; uid: string; classe: Classe; nom: string; pos?: Cell; cause: string; par?: string }
  | { t: "elimine"; uid: string }
  | { t: "abandon"; uid: string; raison: string };
export type Manche = { manche: number; evts: Evt[] };

export type ClasseDef = {
  nom: string; vitesse: number; coque: number; portee: number; portee_min: number; precision: number;
  chute: number; degats: number; vision: number; esquive: number; valeur: number; lourd: boolean; role: string;
};
export type TempsDef = {
  nom: string; couts: [number, number, number, number]; vision: number; vision_max: number | null;
  precision: number; precision_loin: number; recif: number;
};
export type Regles = {
  classes: Record<Classe, ClasseDef>; temps: Record<Temps, TempsDef>; pavillons: PavillonId[];
  min: number; max: number; bornes: { manches: [number, number]; plan: [number, number] };
  garde: number; lourd: number; critique: number; points: number; pas_en_plus: number; resolution: number;
};

export type VueSalon = {
  type: "salon"; id: string; code: string; public: boolean; phase: Phase; manche: number; hote: string;
  options: { manches: number; plan: number }; echeance: number | null; maintenant: number;
  joueurs: Joueur[]; moi: string | null; graine: number | null; carte: Carte | null;
  meteo: Meteo | null; prevision: Meteo | null; navires: Navire[]; fantomes: Fantome[];
  ordres: Record<string, Ordre>; cibles: Record<string, Cible[]>; demasques?: string[];
  historique: Manche[]; absences: number; absences_max: number; stats: Stats | null; fin: Fin | null;
  connectes: string[]; peut: { regler: boolean; lancer: boolean; revanche: boolean }; regles: Regles;
};
export type SalonOuvert = { id: string; code: string; hote: string; joueurs: number; options: { manches: number; plan: number }; cree: number };
export type VueQuai = {
  type: "quai"; maintenant: number; salons: SalonOuvert[]; mon_salon: string | null;
  moi: { uid: string; nom: string; avatar: string };
};

// ─────────────────────────── Libellés ───────────────────────────
export const PAVILLONS: Record<PavillonId, { nom: string; royaume: string; couleur: string; fonce: string }> = {
  lion: { nom: "Lion d'Or", royaume: "Royaume d'Auréval", couleur: "#e0ac3e", fonce: "#5c3d0c" },
  kraken: { nom: "Kraken", royaume: "Principauté des Abysses", couleur: "#2fb3a8", fonce: "#0b3b39" },
  corbeau: { nom: "Corbeau", royaume: "Comté de Noirval", couleur: "#9a7ae0", fonce: "#2c1d52" },
  rose: { nom: "Rose Pourpre", royaume: "Duché de Carmin", couleur: "#df4f58", fonce: "#4f1016" },
  loup: { nom: "Loup Blanc", royaume: "Marches du Givre", couleur: "#d6e1ea", fonce: "#2f3c48" },
  soleil: { nom: "Soleil", royaume: "Empire d'Ambre", couleur: "#f08a3c", fonce: "#55260a" },
  ancre: { nom: "Ancre", royaume: "Ligue des Ports", couleur: "#4f86e8", fonce: "#132b5c" },
  dragon: { nom: "Dragon", royaume: "Îles d'Émeraude", couleur: "#62c46a", fonce: "#163d1a" },
};

export const DIRECTIONS = ["est", "nord-est", "nord-ouest", "ouest", "sud-ouest", "sud-est"];
export const ALLURES = ["vent arrière", "grand largue", "près", "face au vent"];
export const TERRAINS: Record<string, { nom: string; texte: string }> = {
  ".": { nom: "Mer", texte: "Navigable." },
  "#": { nom: "Île", texte: "Infranchissable ; bloque les tirs, pas la vue." },
  "^": { nom: "Récif", texte: "On y entre, mais on s'y échoue : fin du mouvement et dégâts (2 en tempête)." },
  P: { nom: "Port", texte: "Un navire qui y termine la manche répare 1 point de coque." },
};
export const RAISONS_FIN: Record<Fin["raison"], string> = {
  derniere_flotte: "Dernière flotte à flot",
  limite: "Limite de manches atteinte — départage",
  aneantissement: "Anéantissement mutuel — départage aux dégâts",
  anticipee: "Plus aucun capitaine humain en lice",
};

// ─────────────────────────── Hexagones (pointe en haut, rangées impaires décalées) ───────────────────────────
const DIRS: Cell[] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export const cle = (c: Cell) => `${c[0]},${c[1]}`;
export const memeCase = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];

export function axial([c, r]: Cell): Cell {
  return [c - (r - (r & 1)) / 2, r];
}

export function decale(q: number, r: number): Cell {
  return [q + (r - (r & 1)) / 2, r];
}

export function distance(a: Cell, b: Cell): number {
  const [qa, ra] = axial(a);
  const [qb, rb] = axial(b);
  const dq = qa - qb, dr = ra - rb;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

export function voisin(cell: Cell, d: number): Cell {
  const [q, r] = axial(cell);
  return decale(q + DIRS[d][0], r + DIRS[d][1]);
}

export function direction(a: Cell, b: Cell): number | null {
  for (let d = 0; d < 6; d++) if (memeCase(voisin(a, d), b)) return d;
  return null;
}

export const ecart = (d: number, vent: number) => Math.min(((d - vent) % 6 + 6) % 6, ((vent - d) % 6 + 6) % 6);

export function disque(cell: Cell, rayon: number): Cell[] {
  const [q0, r0] = axial(cell);
  const out: Cell[] = [];
  for (let dq = -rayon; dq <= rayon; dq++)
    for (let dr = Math.max(-rayon, -dq - rayon); dr <= Math.min(rayon, -dq + rayon); dr++)
      out.push(decale(q0 + dq, r0 + dr));
  return out;
}

function arrondi(x: number, y: number, z: number): Cell {
  let rx = Math.floor(x + 0.5), ry = Math.floor(y + 0.5), rz = Math.floor(z + 0.5);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return decale(rx, rz);
}

/** Même interpolation que le serveur (décalage identique) : même verdict de ligne de tir. */
export function ligne(a: Cell, b: Cell): Cell[] {
  const n = distance(a, b);
  const [qa, ra] = axial(a);
  const [qb, rb] = axial(b);
  const ax = qa + 1e-6, az = ra - 2e-6, bx = qb + 1e-6, bz = rb - 2e-6;
  const out: Cell[] = [];
  for (let i = 0; i <= n; i++) {
    const t = n ? i / n : 0;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    out.push(arrondi(x, -x - z, z));
  }
  return out;
}

// ─────────────────────────── Carte & règles (miroir d'aide) ───────────────────────────
export function terrain(carte: Carte, [c, r]: Cell): string | null {
  return c >= 0 && c < carte.l && r >= 0 && r < carte.h ? carte.terrain[r][c] : null;
}

export const navigable = (carte: Carte, cell: Cell) => [".", "^", "P"].includes(terrain(carte, cell) ?? "#");

export const ligneDeTir = (carte: Carte, a: Cell, b: Cell) =>
  ligne(a, b).slice(1, -1).every((c) => terrain(carte, c) !== "#");

export function coutPas(regles: Regles, meteo: Meteo, d: number) {
  return regles.temps[meteo.temps].couts[ecart(d, meteo.vent)];
}

export const pointsMouvement = (regles: Regles, classe: Classe) => regles.classes[classe].vitesse * regles.points;
export const pasMax = (regles: Regles, classe: Classe) => regles.classes[classe].vitesse + regles.pas_en_plus;

/** Cases atteignables cette manche → chemin le moins coûteux (mêmes règles que le serveur). */
export function atteignables(regles: Regles, carte: Carte, meteo: Meteo, classe: Classe, depart: Cell): Map<string, Cell[]> {
  const pts = pointsMouvement(regles, classe), smax = pasMax(regles, classe);
  type Etat = { cell: Cell; cout: number; chemin: Cell[] };
  let front: Etat[] = [{ cell: depart, cout: 0, chemin: [] }];
  const meilleur = new Map<string, Etat>([[`${cle(depart)}|0`, front[0]]]);
  for (let pas = 0; pas < smax; pas++) {
    const suivant: Etat[] = [];
    for (const e of front) {
      if (e.chemin.length && terrain(carte, e.cell) === "^") continue;
      for (let d = 0; d < 6; d++) {
        const v = voisin(e.cell, d);
        if (!navigable(carte, v)) continue;
        const c2 = e.cout + coutPas(regles, meteo, d);
        if (c2 > pts) continue;
        const k = `${cle(v)}|${pas + 1}`;
        const ex = meilleur.get(k);
        if (!ex || ex.cout > c2) {
          const n = { cell: v, cout: c2, chemin: [...e.chemin, v] };
          meilleur.set(k, n);
          if (!ex) suivant.push(n);
          else Object.assign(ex, n);
        }
      }
    }
    front = suivant;
  }
  const out = new Map<string, Cell[]>();
  [...meilleur.values()]
    .sort((a, b) => a.cout - b.cout || a.chemin.length - b.chemin.length)
    .forEach((e) => { if (!out.has(cle(e.cell))) out.set(cle(e.cell), e.chemin); });
  return out;
}

export function coutChemin(regles: Regles, meteo: Meteo, depart: Cell, chemin: Cell[]) {
  let ici = depart, cout = 0;
  for (const c of chemin) {
    const d = direction(ici, c);
    if (d === null) return Infinity;
    cout += coutPas(regles, meteo, d);
    ici = c;
  }
  return cout;
}

export function chance(regles: Regles, meteo: Meteo, tireur: Classe, cible: Classe, dist: number,
  garde = false, bouge = false): number {
  const k = regles.classes[tireur], t = regles.temps[meteo.temps];
  let p = k.precision - k.chute * (dist - 1) - regles.classes[cible].esquive + t.precision;
  if (dist > 2) p += t.precision_loin;
  if (garde) p -= regles.garde;
  if (bouge && k.lourd) p -= regles.lourd;
  return Math.max(5, Math.min(95, p));
}

export function tirPossible(regles: Regles, carte: Carte, classe: Classe, de: Cell, vers: Cell): [boolean, string] {
  const k = regles.classes[classe], dist = distance(de, vers);
  if (dist < k.portee_min) return [false, "trop près pour cette pièce"];
  if (dist > k.portee) return [false, "hors de portée"];
  if (!ligneDeTir(carte, de, vers)) return [false, "ligne de tir masquée par une île"];
  return [true, ""];
}

export function rayonVision(regles: Regles, classe: Classe, meteo: Meteo) {
  const t = regles.temps[meteo.temps];
  let r = regles.classes[classe].vision + t.vision;
  if (t.vision_max !== null) r = Math.min(r, t.vision_max);
  return Math.max(1, r);
}

/** Cases vues par mes navires (affichage du brouillard — le serveur, lui, filtre les données). */
export function champ(regles: Regles, meteo: Meteo, mien: Navire[]): Set<string> {
  const s = new Set<string>();
  for (const n of mien) for (const c of disque(n.pos, rayonVision(regles, n.classe, meteo))) s.add(cle(c));
  return s;
}

export function destination(n: Navire, o?: Ordre): Cell {
  return o && o.chemin.length ? o.chemin[o.chemin.length - 1] : n.pos;
}

export function formatDuree(s: number) {
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return m ? `${m} min ${String(r).padStart(2, "0")}` : `${r} s`;
}
