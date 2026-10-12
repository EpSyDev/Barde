// Rendu de la carte des Flottes Royales — Canvas 2D, isolé de toute logique de jeu.
//
// Le rendu ne décide de rien : il dessine une « scène » (vue serveur + brouillon d'ordres +
// sélection) et rejoue la dernière manche résolue sous forme d'animation. Changer un effet
// visuel ne peut pas changer une règle. Une seule boucle requestAnimationFrame, sans
// re-rendu React par image ; elle s'arrête d'elle-même quand l'onglet est masqué.
//
// Repère « monde » : 1 unité = rayon d'un hexagone. Le terrain est peint une fois dans une
// toile hors écran, puis recopié à chaque image avec la caméra.

import {
  cle, PAVILLONS, terrain as terrainDe,
  type Carte, type Cell, type Classe, type Manche, type Meteo, type Navire, type Ordre, type PavillonId,
} from "@/lib/flotte";
import { EMBLEMES } from "./Emblemes";

const R3 = Math.sqrt(3);
const PX_CACHE = 48;                 // résolution de la toile de terrain (px par unité)

// ─────────────────────────── Géométrie ───────────────────────────
export function centre([c, r]: Cell): [number, number] {
  return [R3 * (c + 0.5 * (r & 1)) + R3 / 2, 1.5 * r + 1];
}

export function caseDe(x: number, y: number): Cell {
  const xp = x - R3 / 2, yp = y - 1;
  const q = (R3 / 3) * xp - yp / 3, r = (2 / 3) * yp;
  let rx = Math.round(q), rz = Math.round(r), ry = Math.round(-q - r);
  const dx = Math.abs(rx - q), dy = Math.abs(ry + q + r), dz = Math.abs(rz - r);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy <= dz) rz = -rx - ry;
  return [rx + (rz - (rz & 1)) / 2, rz];
}

export const tailleMonde = (carte: Carte): [number, number] => [R3 * (carte.l + 0.5), 1.5 * (carte.h - 1) + 2];

function hexagone(ctx: CanvasRenderingContext2D | Path2D, x: number, y: number, s = 1) {
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    const px = x + s * Math.cos(a), py = y + s * Math.sin(a);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** Angle écran d'un cap (0 = est, sens trigonométrique, y vers le bas). */
export const angleCap = (cap: number) => (-cap * Math.PI) / 3;

/** Bruit déterministe par case : la carte est la même à chaque image et chez chacun. */
function hache(c: number, r: number, k: number) {
  let h = (c * 374761393 + r * 668265263 + k * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const doux = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// ─────────────────────────── Scène ───────────────────────────
export type Scene = {
  carte: Carte;
  meteo: Meteo | null;
  navires: Navire[];
  fantomes: { id: string; uid: string; classe: Classe; pos: Cell; manche: number }[];
  moi: string | null;
  pavillons: Record<string, PavillonId>;
  ordres: Record<string, Ordre>;        // brouillon (mes navires)
  selection: string | null;
  accessibles: Map<string, Cell[]> | null;
  risques: Set<string>;                 // cases où ma propre flotte sera : choc probable
  survol: Cell | null;
  champ: Set<string> | null;            // null = pas de brouillard (fin de partie, spectateur)
  ciblesVues: { de: Cell; vers: Cell; chance: number; possible: boolean }[];
  reduit: boolean;
  qualite: "haute" | "basse";
};

// ─────────────────────────── Animation d'une manche ───────────────────────────
type Piste = { proto: Navire; chemin: Cell[]; entre: boolean; sort: boolean };
type Effet = {
  type: "tir" | "choc" | "recif" | "reparation" | "coule";
  t: number; de?: Cell | null; vers?: Cell | null; touche?: boolean | null; critique?: boolean | null;
  degats?: number | null; texte?: string; graine: number;
};

export class Animation {
  t0: number;
  pistes = new Map<string, Piste>();
  effets: Effet[] = [];
  coules = new Map<string, { proto: Navire; t: number }>();
  tMouv = 0;
  duree = 0;

  constructor(m: Manche, connus: Map<string, Navire>, reduit: boolean, maintenant: number) {
    this.t0 = maintenant;
    let maxPas = 0;
    for (const e of m.evts) if (e.t === "mouv") maxPas = Math.max(maxPas, e.chemin.length - 1);
    this.tMouv = reduit ? 0 : Math.min(2.6, 0.42 * maxPas);
    const vol = reduit ? 0 : 0.6;
    let t = this.tMouv + (maxPas ? 0.25 : 0);
    let graine = m.manche * 7919;
    const proto = (id: string, de?: Partial<Navire>): Navire | null => {
      const n = connus.get(id);
      if (n) return n;
      if (de && de.classe && de.uid) return { id, uid: de.uid, classe: de.classe, nom: de.nom || "", pos: de.pos || [0, 0], cap: 0, coque: 0, max: 1 };
      return null;
    };
    for (const e of m.evts) {
      graine += 31;
      if (e.t === "mouv") {
        const p = proto(e.id);
        if (p) this.pistes.set(e.id, { proto: p, chemin: e.chemin, entre: e.debut_vu === false, sort: e.fin_vue === false });
      } else if (e.t === "choc") {
        this.effets.push({ type: "choc", t: this.tMouv, vers: e.pos, degats: Math.max(0, ...Object.values(e.degats)), graine });
      } else if (e.t === "recif") {
        this.effets.push({ type: "recif", t: this.tMouv, vers: e.pos, degats: e.degats, graine });
      } else if (e.t === "tir") {
        this.effets.push({ type: "tir", t, de: e.pos_de, vers: e.pos_vers, touche: e.touche, critique: e.critique, degats: e.degats, graine });
        t += reduit ? 0 : 0.16;
      } else if (e.t === "reparation") {
        this.effets.push({ type: "reparation", t: 0, vers: e.pos, graine });
      }
    }
    const tCoule = t + vol + 0.2;
    for (const e of m.evts) {
      if (e.t !== "coule" || !e.pos) continue;
      const p = proto(e.id, e);
      if (p) this.coules.set(e.id, { proto: { ...p, pos: e.pos }, t: tCoule });
      this.effets.push({ type: "coule", t: tCoule, vers: e.pos, graine: graine++ });
    }
    this.duree = Math.max(tCoule + 1.6, reduit ? 2.6 : 0);
    for (const ef of this.effets) if (ef.type === "reparation") ef.t = this.duree - 1.4;
  }

  /** Position animée d'un navire (null = pas d'animation pour lui). */
  position(id: string, t: number): { cell: [number, number]; angle: number | null; alpha: number } | null {
    const p = this.pistes.get(id);
    if (!p) return null;
    const n = p.chemin.length - 1;
    const u = this.tMouv ? doux(t / this.tMouv) * n : n;
    const i = Math.min(n - 1, Math.floor(u));
    const f = n ? u - i : 0;
    const a = centre(p.chemin[Math.max(0, i)]);
    const b = centre(p.chemin[Math.min(n, i + 1)]);
    let alpha = 1;
    if (p.entre) alpha = Math.min(alpha, doux(u / Math.max(1, n) * 3));
    if (p.sort) alpha = Math.min(alpha, doux((n - u) * 1.5 + (u < n ? 0.15 : 0)));
    const angle = n ? Math.atan2(b[1] - a[1], b[0] - a[0]) : null;
    return { cell: [lerp(a[0], b[0], f), lerp(a[1], b[1], f)], angle, alpha };
  }

  fini(t: number) {
    return t >= this.duree;
  }
}

// ─────────────────────────── Moteur de rendu ───────────────────────────
export class Rendu {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private larg = 1;
  private haut = 1;
  private cache: HTMLCanvasElement | null = null;
  private cacheCle = "";
  private brume: { cle: string; chemin: Path2D } | null = null;
  private emblemes = new Map<PavillonId, Path2D>();
  private police = "Georgia, serif";
  private raf = 0;
  private vivant = true;
  scene: Scene | null = null;
  anim: Animation | null = null;
  cam = { x: 0, y: 0, zoom: 30 };
  private ajuste = false;
  private focus: Cell[] | null = null;

  constructor(private toile: HTMLCanvasElement) {
    const ctx = toile.getContext("2d");
    if (!ctx) throw new Error("canvas 2D indisponible");
    this.ctx = ctx;
    this.police = getComputedStyle(document.body).fontFamily || this.police;
    for (const id of Object.keys(EMBLEMES) as PavillonId[]) this.emblemes.set(id, new Path2D(EMBLEMES[id]));
    this.boucle = this.boucle.bind(this);
    this.raf = requestAnimationFrame(this.boucle);
  }

  detruire() {
    this.vivant = false;
    cancelAnimationFrame(this.raf);
  }

  redimensionner(l: number, h: number) {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.larg = Math.max(1, l);
    this.haut = Math.max(1, h);
    this.toile.width = Math.round(this.larg * this.dpr);
    this.toile.height = Math.round(this.haut * this.dpr);
    if (!this.ajuste && this.scene) this.ajuster();
  }

  definir(s: Scene) {
    const neuve = !this.scene || this.scene.carte !== s.carte;
    this.scene = s;
    if (neuve) {
      this.ajuste = false;
      this.ajuster();
    }
  }

  jouer(m: Manche, connus: Map<string, Navire>) {
    this.anim = new Animation(m, connus, !!this.scene?.reduit, performance.now() / 1000);
  }

  // ── caméra ──
  private zoomMin() {
    if (!this.scene) return 10;
    const [w, h] = tailleMonde(this.scene.carte);
    return Math.min(this.larg / (w + 1), this.haut / (h + 1)) * 0.85;
  }

  ajuster() {
    if (!this.scene || this.larg < 2) return;
    const [w, h] = tailleMonde(this.scene.carte);
    this.cam = { x: w / 2, y: h / 2, zoom: Math.min(this.larg / (w + 0.6), this.haut / (h + 0.6)) };
    this.ajuste = true;
    // Carte entière trop petite pour lire les navires (téléphone) : on part sur ma flotte.
    if (this.focus?.length && this.cam.zoom < 24) {
      const pts = this.focus.map(centre);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      this.cam.x = (Math.min(...xs) + Math.max(...xs)) / 2;
      this.cam.y = (Math.min(...ys) + Math.max(...ys)) / 2;
      this.cam.zoom = Math.min(30, Math.min(this.larg / 9, this.haut / 9));
      this.borner();
    }
  }

  /** Cases à privilégier au premier cadrage (ma flotte). */
  preferer(cases: Cell[]) {
    const premier = !this.focus;
    this.focus = cases;
    if (premier && this.ajuste) this.ajuster();
  }

  centrerSur(cell: Cell) {
    const [x, y] = centre(cell);
    this.cam.x = x;
    this.cam.y = y;
    this.borner();
  }

  zoomer(facteur: number, sx = this.larg / 2, sy = this.haut / 2) {
    const [wx, wy] = this.versMonde(sx, sy);
    this.cam.zoom = Math.max(this.zoomMin(), Math.min(110, this.cam.zoom * facteur));
    const [nx, ny] = this.versMonde(sx, sy);
    this.cam.x += wx - nx;
    this.cam.y += wy - ny;
    this.borner();
  }

  deplacer(dx: number, dy: number) {
    this.cam.x -= dx / this.cam.zoom;
    this.cam.y -= dy / this.cam.zoom;
    this.borner();
  }

  private borner() {
    if (!this.scene) return;
    const [w, h] = tailleMonde(this.scene.carte);
    this.cam.x = Math.max(0, Math.min(w, this.cam.x));
    this.cam.y = Math.max(0, Math.min(h, this.cam.y));
  }

  versMonde(sx: number, sy: number): [number, number] {
    return [(sx - this.larg / 2) / this.cam.zoom + this.cam.x, (sy - this.haut / 2) / this.cam.zoom + this.cam.y];
  }

  versEcran(wx: number, wy: number): [number, number] {
    return [(wx - this.cam.x) * this.cam.zoom + this.larg / 2, (wy - this.cam.y) * this.cam.zoom + this.haut / 2];
  }

  caseAuPoint(sx: number, sy: number): Cell | null {
    if (!this.scene) return null;
    const c = caseDe(...this.versMonde(sx, sy));
    return terrainDe(this.scene.carte, c) === null ? null : c;
  }

  // ── boucle ──
  private boucle(ms: number) {
    if (!this.vivant) return;
    this.raf = requestAnimationFrame(this.boucle);
    if (!this.scene || document.hidden) return;
    if (this.scene.qualite === "basse" && Math.floor(ms / 16.7) % 2) return;   // ~30 i/s
    try {
      this.dessiner(ms / 1000);
    } catch (e) {
      console.error("flotte/rendu", e);
    }
  }

  private dessiner(t: number) {
    const s = this.scene!;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Fond : abysses, vignettage.
    const g = ctx.createRadialGradient(this.larg / 2, this.haut / 2, 0, this.larg / 2, this.haut / 2, Math.hypot(this.larg, this.haut) / 1.6);
    g.addColorStop(0, "#0f3346");
    g.addColorStop(1, "#04121c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.larg, this.haut);

    ctx.setTransform(this.dpr * this.cam.zoom, 0, 0, this.dpr * this.cam.zoom,
      this.dpr * (this.larg / 2 - this.cam.x * this.cam.zoom), this.dpr * (this.haut / 2 - this.cam.y * this.cam.zoom));
    this.dessinerMer(t);
    const [w, h] = tailleMonde(s.carte);
    const cache = this.terrain();
    ctx.drawImage(cache, -3, -3, w + 6, h + 6);
    if (s.champ) this.dessinerBrume(t);
    this.dessinerPlanification(t);
    const ta = this.anim ? performance.now() / 1000 - this.anim.t0 : 0;
    if (this.anim && this.anim.fini(ta) && ta > this.anim.duree + 0.2) this.anim = null;
    this.dessinerFantomes(t);
    this.dessinerNavires(t, ta);
    if (this.anim) this.dessinerEffets(ta);
    if (s.survol) {
      const [x, y] = centre(s.survol);
      ctx.beginPath();
      hexagone(ctx, x, y, 0.96);
      ctx.strokeStyle = "rgba(243, 215, 142, 0.75)";
      ctx.lineWidth = 0.05;
      ctx.stroke();
    }
  }

  // ── mer (vivante en phase 4 : houle procédurale) ──
  private dessinerMer(t: number) {
    const ctx = this.ctx, s = this.scene!;
    const [w, h] = tailleMonde(s.carte);
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "#155068");
    g.addColorStop(0.5, "#11455c");
    g.addColorStop(1, "#0c3447");
    ctx.fillStyle = g;
    ctx.fillRect(-3, -3, w + 6, h + 6);
    // Reflets lents : quelques nappes de lumière qui dérivent avec le vent.
    const vent = s.meteo ? angleCap(s.meteo.vent) : 0;
    const dx = Math.cos(vent) * t * 0.08, dy = Math.sin(vent) * t * 0.08;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 7; i++) {
      const x = ((hache(i, 1, 3) * w + dx * (1 + i * 0.2)) % (w + 6) + w + 6) % (w + 6) - 3;
      const y = ((hache(i, 2, 5) * h + dy * (1 + i * 0.2)) % (h + 6) + h + 6) % (h + 6) - 3;
      const r = 3 + hache(i, 3, 7) * 5;
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, "rgba(90, 170, 200, 0.07)");
      rg.addColorStop(1, "rgba(90, 170, 200, 0)");
      ctx.fillStyle = rg;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    ctx.restore();
  }

  // ── terrain (peint une fois) ──
  private terrain(): HTMLCanvasElement {
    const carte = this.scene!.carte;
    const k = carte.terrain.join("|");
    if (this.cache && this.cacheCle === k) return this.cache;
    const [w, h] = tailleMonde(carte);
    const toile = document.createElement("canvas");
    toile.width = Math.ceil((w + 6) * PX_CACHE);
    toile.height = Math.ceil((h + 6) * PX_CACHE);
    const c = toile.getContext("2d")!;
    c.setTransform(PX_CACHE, 0, 0, PX_CACHE, 3 * PX_CACHE, 3 * PX_CACHE);
    const cellules: { cell: Cell; x: number; y: number; t: string }[] = [];
    for (let r = 0; r < carte.h; r++)
      for (let q = 0; q < carte.l; q++) {
        const [x, y] = centre([q, r]);
        cellules.push({ cell: [q, r], x, y, t: carte.terrain[r][q] });
      }
    // Hors carte : on assombrit tout, puis on évide les cases.
    c.fillStyle = "rgba(2, 10, 16, 0.62)";
    c.fillRect(-3, -3, w + 6, h + 6);
    c.globalCompositeOperation = "destination-out";
    c.beginPath();
    for (const e of cellules) hexagone(c, e.x, e.y, 1.01);
    c.fill();
    c.globalCompositeOperation = "source-over";
    // Quadrillage discret.
    c.beginPath();
    for (const e of cellules) if (e.t !== "#") hexagone(c, e.x, e.y, 0.985);
    c.strokeStyle = "rgba(170, 220, 240, 0.075)";
    c.lineWidth = 0.035;
    c.stroke();
    const iles = cellules.filter((e) => e.t === "#");
    const decal = (e: (typeof iles)[number], sel: number): [number, number] => {
      const [q, r] = e.cell;
      return [e.x + (hache(q, r, 11 + sel) - 0.5) * 0.18, e.y + (hache(q, r, 13 + sel) - 0.5) * 0.18];
    };
    const paires: [(typeof iles)[number], (typeof iles)[number]][] = [];
    for (let i = 0; i < iles.length; i++)
      for (let j = i + 1; j < iles.length; j++)
        if (Math.hypot(iles[i].x - iles[j].x, iles[i].y - iles[j].y) < 1.8) paires.push([iles[i], iles[j]]);
    // Hauts-fonds autour des îles.
    for (const e of iles) {
      const g = c.createRadialGradient(e.x, e.y, 0.4, e.x, e.y, 1.9);
      g.addColorStop(0, "rgba(80, 190, 190, 0.32)");
      g.addColorStop(1, "rgba(80, 190, 190, 0)");
      c.fillStyle = g;
      c.beginPath();
      c.arc(e.x, e.y, 1.9, 0, 7);
      c.fill();
    }
    // Une couche de terre = des disques par case + des « ponts » entre cases voisines : les
    // îles forment des masses continues, aux contours irréguliers.
    const blob = (rayon: number, couleur: string, sel = 0) => {
      c.fillStyle = couleur;
      c.beginPath();
      for (const e of iles) {
        const [x, y] = decal(e, sel);
        const rr = rayon * (0.92 + hache(e.cell[0], e.cell[1], 17 + sel) * 0.16);
        c.moveTo(x + rr, y);
        c.arc(x, y, rr, 0, Math.PI * 2);
      }
      c.fill();
      c.strokeStyle = couleur;
      c.lineWidth = rayon * 1.85;
      c.lineCap = "round";
      c.beginPath();
      for (const [a, b] of paires) {
        c.moveTo(...decal(a, sel));
        c.lineTo(...decal(b, sel));
      }
      c.stroke();
    };
    // Écume de côte, plage, herbe, puis relief.
    c.save();
    c.shadowColor = "rgba(230, 250, 255, 0.55)";
    c.shadowBlur = 0.3 * PX_CACHE;
    blob(1.04, "rgba(220, 240, 240, 0.45)");
    c.restore();
    blob(0.97, "#c8ae78");
    blob(0.86, "#a8915f", 1);
    blob(0.72, "#55723a", 2);
    blob(0.55, "#41602c", 3);
    blob(0.32, "#36522a", 4);
    for (const e of iles) {
      const [q, r] = e.cell;
      // Collines ombrées et bosquets.
      const n = 2 + Math.floor(hache(q, r, 23) * 3);
      for (let i = 0; i < n; i++) {
        const a = hache(q, r, 30 + i) * Math.PI * 2, d = hache(q, r, 40 + i) * 0.45;
        const x = e.x + Math.cos(a) * d, y = e.y + Math.sin(a) * d;
        const rr = 0.12 + hache(q, r, 50 + i) * 0.16;
        c.fillStyle = "rgba(20, 35, 14, 0.45)";
        c.beginPath();
        c.arc(x + 0.05, y + 0.06, rr, 0, 7);
        c.fill();
        c.fillStyle = hache(q, r, 60 + i) > 0.55 ? "#6b7a4a" : "#2f4d22";
        c.beginPath();
        c.arc(x, y, rr, 0, 7);
        c.fill();
        c.fillStyle = "rgba(255, 245, 200, 0.12)";
        c.beginPath();
        c.arc(x - rr * 0.3, y - rr * 0.35, rr * 0.45, 0, 7);
        c.fill();
      }
    }
    // Récifs : écume et rochers.
    for (const e of cellules.filter((x) => x.t === "^")) {
      const [q, r] = e.cell;
      c.strokeStyle = "rgba(225, 245, 245, 0.35)";
      c.lineWidth = 0.05;
      c.setLineDash([0.12, 0.1]);
      c.beginPath();
      c.arc(e.x, e.y, 0.62, 0, 7);
      c.stroke();
      c.setLineDash([]);
      for (let i = 0; i < 6; i++) {
        const a = hache(q, r, 70 + i) * Math.PI * 2, d = 0.1 + hache(q, r, 80 + i) * 0.42;
        const x = e.x + Math.cos(a) * d, y = e.y + Math.sin(a) * d, rr = 0.07 + hache(q, r, 90 + i) * 0.1;
        c.fillStyle = "rgba(230, 250, 250, 0.4)";
        c.beginPath();
        c.arc(x, y, rr * 1.5, 0, 7);
        c.fill();
        c.fillStyle = "#3b4146";
        c.beginPath();
        c.arc(x, y, rr, 0, 7);
        c.fill();
        c.fillStyle = "#7d858a";
        c.beginPath();
        c.arc(x - rr * 0.3, y - rr * 0.3, rr * 0.5, 0, 7);
        c.fill();
      }
    }
    // Ports : jetée, entrepôt et feu de port.
    for (const e of cellules.filter((x) => x.t === "P")) {
      c.strokeStyle = "rgba(240, 212, 137, 0.55)";
      c.lineWidth = 0.05;
      c.setLineDash([0.16, 0.1]);
      c.beginPath();
      hexagone(c, e.x, e.y, 0.82);
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = "#5a3b1c";
      c.fillRect(e.x - 0.55, e.y + 0.18, 0.75, 0.14);
      c.fillRect(e.x - 0.1, e.y - 0.1, 0.12, 0.42);
      c.fillStyle = "#7a5530";
      c.fillRect(e.x + 0.18, e.y - 0.48, 0.34, 0.3);
      c.fillStyle = "#9a3b25";
      c.beginPath();
      c.moveTo(e.x + 0.14, e.y - 0.48);
      c.lineTo(e.x + 0.35, e.y - 0.66);
      c.lineTo(e.x + 0.56, e.y - 0.48);
      c.fill();
      const lg = c.createRadialGradient(e.x - 0.45, e.y - 0.35, 0, e.x - 0.45, e.y - 0.35, 0.4);
      lg.addColorStop(0, "rgba(255, 214, 120, 0.9)");
      lg.addColorStop(1, "rgba(255, 214, 120, 0)");
      c.fillStyle = lg;
      c.beginPath();
      c.arc(e.x - 0.45, e.y - 0.35, 0.4, 0, 7);
      c.fill();
      c.fillStyle = "#e9dcbc";
      c.fillRect(e.x - 0.5, e.y - 0.38, 0.1, 0.32);
    }
    this.cache = toile;
    this.cacheCle = k;
    return toile;
  }

  // ── brouillard de guerre ──
  private dessinerBrume(t: number) {
    const s = this.scene!, ctx = this.ctx;
    const k = [...s.champ!].sort().join(";");
    if (!this.brume || this.brume.cle !== k) {
      const p = new Path2D();
      for (let r = 0; r < s.carte.h; r++)
        for (let q = 0; q < s.carte.l; q++)
          if (!s.champ!.has(cle([q, r]))) {
            const [x, y] = centre([q, r]);
            hexagone(p, x, y, 1.02);
          }
      this.brume = { cle: k, chemin: p };
    }
    ctx.save();
    ctx.fillStyle = "rgba(5, 12, 22, 0.6)";
    ctx.fill(this.brume.chemin);
    ctx.clip(this.brume.chemin);
    // Volutes : grain lent qui signale « ici, on ne voit pas ».
    if (s.qualite === "haute" && !s.reduit) {
      ctx.globalAlpha = 0.5;
      const [w, h] = tailleMonde(s.carte);
      for (let i = 0; i < 9; i++) {
        const x = (hache(i, 4, 1) * w + t * 0.05 * (i % 3 + 1)) % (w + 4) - 2;
        const y = hache(i, 5, 2) * h;
        const rg = ctx.createRadialGradient(x, y, 0, x, y, 3.5);
        rg.addColorStop(0, "rgba(150, 170, 190, 0.12)");
        rg.addColorStop(1, "rgba(150, 170, 190, 0)");
        ctx.fillStyle = rg;
        ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
      }
    }
    ctx.restore();
  }

  // ── ordres en cours ──
  private dessinerPlanification(t: number) {
    const s = this.scene!, ctx = this.ctx;
    if (this.anim) return;
    if (s.accessibles) {
      ctx.save();
      for (const k of s.accessibles.keys()) {
        const [q, r] = k.split(",").map(Number);
        const [x, y] = centre([q, r]);
        const risque = s.risques.has(k);
        ctx.beginPath();
        hexagone(ctx, x, y, 0.9);
        ctx.fillStyle = risque ? "rgba(230, 90, 70, 0.16)" : "rgba(240, 212, 137, 0.11)";
        ctx.fill();
        ctx.strokeStyle = risque ? "rgba(230, 90, 70, 0.45)" : "rgba(240, 212, 137, 0.28)";
        ctx.lineWidth = 0.03;
        ctx.stroke();
      }
      ctx.restore();
    }
    // Aperçu au survol : le chemin qu'on tracerait.
    const sel = s.navires.find((n) => n.id === s.selection);
    if (sel && s.survol && s.accessibles?.has(cle(s.survol))) {
      this.tracerChemin([sel.pos, ...s.accessibles.get(cle(s.survol))!], "rgba(243, 215, 142, 0.45)", 0.06, [0.15, 0.12], t);
    }
    for (const n of s.navires) {
      const o = s.ordres[n.id];
      if (!o || n.uid !== s.moi) continue;
      if (o.chemin.length) {
        const choisi = n.id === s.selection;
        this.tracerChemin([n.pos, ...o.chemin], choisi ? "#f3d78e" : "rgba(243, 215, 142, 0.6)", choisi ? 0.08 : 0.055,
          choisi ? [] : [0.18, 0.12], t);
        const [x, y] = centre(o.chemin[o.chemin.length - 1]);
        this.navire(n.classe, x, y, angleCap(n.cap), {
          pav: s.pavillons[n.uid], alpha: 0.32, mien: true, t, ratio: n.coque / n.max, contour: true,
        });
      }
    }
    for (const c of s.ciblesVues) {
      const [x1, y1] = centre(c.de), [x2, y2] = centre(c.vers);
      ctx.save();
      ctx.strokeStyle = c.possible ? "rgba(230, 90, 70, 0.9)" : "rgba(230, 90, 70, 0.4)";
      ctx.lineWidth = 0.06;
      ctx.setLineDash(c.possible ? [] : [0.12, 0.12]);
      ctx.lineDashOffset = -t * 0.6;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
      // Mire.
      ctx.beginPath();
      ctx.arc(x2, y2, 0.62, 0, 7);
      ctx.moveTo(x2 - 0.85, y2);
      ctx.lineTo(x2 - 0.4, y2);
      ctx.moveTo(x2 + 0.4, y2);
      ctx.lineTo(x2 + 0.85, y2);
      ctx.moveTo(x2, y2 - 0.85);
      ctx.lineTo(x2, y2 - 0.4);
      ctx.moveTo(x2, y2 + 0.4);
      ctx.lineTo(x2, y2 + 0.85);
      ctx.stroke();
      this.etiquette(c.possible ? `${c.chance} %` : "—", (x1 + x2) / 2, (y1 + y2) / 2 - 0.25, c.possible ? "#ffd9cf" : "#c9a59b");
      ctx.restore();
    }
  }

  private tracerChemin(cases: Cell[], couleur: string, epaisseur: number, tirets: number[], t: number) {
    const ctx = this.ctx;
    if (cases.length < 2) return;
    ctx.save();
    ctx.strokeStyle = couleur;
    ctx.lineWidth = epaisseur;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash(tirets);
    ctx.lineDashOffset = -t * 0.5;
    ctx.beginPath();
    cases.forEach((c, i) => {
      const [x, y] = centre(c);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    const [xa, ya] = centre(cases[cases.length - 2]), [xb, yb] = centre(cases[cases.length - 1]);
    const a = Math.atan2(yb - ya, xb - xa);
    ctx.fillStyle = couleur;
    ctx.beginPath();
    ctx.moveTo(xb - Math.cos(a) * 0.35, yb - Math.sin(a) * 0.35);
    ctx.lineTo(xb - Math.cos(a) * 0.75 + Math.cos(a + Math.PI / 2) * 0.2, yb - Math.sin(a) * 0.75 + Math.sin(a + Math.PI / 2) * 0.2);
    ctx.lineTo(xb - Math.cos(a) * 0.75 - Math.cos(a + Math.PI / 2) * 0.2, yb - Math.sin(a) * 0.75 - Math.sin(a + Math.PI / 2) * 0.2);
    ctx.fill();
    ctx.restore();
  }

  // ── navires ──
  private dessinerFantomes(t: number) {
    const s = this.scene!;
    for (const f of s.fantomes) {
      const [x, y] = centre(f.pos);
      this.navire(f.classe, x, y, 0, { pav: s.pavillons[f.uid], alpha: 0.28, mien: false, t, ratio: 1, contour: true });
      this.etiquette(`vu m.${f.manche}`, x, y + 0.95, "#b9c6cf");
    }
  }

  private dessinerNavires(t: number, ta: number) {
    const s = this.scene!;
    const anim = this.anim;
    const dessines = new Set<string>();
    const liste: { n: Navire; x: number; y: number; angle: number; alpha: number; coule: number }[] = [];
    for (const n of s.navires) {
      if (n.coule) continue;
      let [x, y] = centre(n.pos);
      let angle = angleCap(n.cap), alpha = 1;
      const p = anim?.position(n.id, ta);
      if (p) {
        [x, y] = p.cell;
        if (p.angle !== null) angle = p.angle;
        alpha = p.alpha;
      }
      dessines.add(n.id);
      liste.push({ n, x, y, angle, alpha, coule: 0 });
    }
    if (anim) {
      // Navires qui sortent de la vue ou sombrent pendant l'animation.
      for (const [id, piste] of anim.pistes) {
        if (dessines.has(id) || anim.coules.has(id)) continue;
        const p = anim.position(id, ta);
        if (p && p.alpha > 0.02) {
          liste.push({ n: piste.proto, x: p.cell[0], y: p.cell[1], angle: p.angle ?? angleCap(piste.proto.cap), alpha: p.alpha, coule: 0 });
          dessines.add(id);
        }
      }
      for (const [id, c] of anim.coules) {
        if (dessines.has(id)) continue;
        const pos = anim.position(id, ta);
        const [x, y] = pos ? pos.cell : centre(c.proto.pos);
        const k = doux((ta - c.t) / 1.4);
        if (k < 1) liste.push({ n: c.proto, x, y, angle: pos?.angle ?? angleCap(c.proto.cap), alpha: 1 - k, coule: k });
      }
    }
    liste.sort((a, b) => a.y - b.y);
    for (const e of liste) {
      const mien = e.n.uid === s.moi;
      this.navire(e.n.classe, e.x, e.y, e.angle, {
        pav: s.pavillons[e.n.uid], alpha: e.alpha, mien, t, ratio: e.n.max ? e.n.coque / e.n.max : 1,
        selection: e.n.id === s.selection, coule: e.coule, graine: e.n.id.length + Number(e.n.id.slice(1)),
      });
      if (!e.coule && e.alpha > 0.5) this.badge(e.n, e.x, e.y);
    }
  }

  /** Emblème du royaume (toujours droit) et jauge de coque, sous le navire. */
  private badge(n: Navire, x: number, y: number) {
    const s = this.scene!, ctx = this.ctx;
    const pav = s.pavillons[n.uid] || "ancre";
    const p = PAVILLONS[pav];
    ctx.save();
    ctx.translate(x - 0.62, y - 0.62);
    ctx.beginPath();
    ctx.arc(0, 0, 0.27, 0, 7);
    ctx.fillStyle = p.fonce;
    ctx.fill();
    ctx.lineWidth = 0.05;
    ctx.strokeStyle = n.uid === s.moi ? "#f3d78e" : p.couleur;
    ctx.stroke();
    ctx.scale(0.019, 0.019);
    ctx.translate(-12, -12);
    ctx.fillStyle = p.couleur;
    ctx.fill(this.emblemes.get(pav)!);
    ctx.restore();
    if (n.max) {
      const larg = 0.16, esp = 0.04, tot = n.max * larg + (n.max - 1) * esp;
      const ratio = n.coque / n.max;
      const couleur = ratio > 0.6 ? "#8ccf6e" : ratio > 0.3 ? "#e6b84a" : "#e0563f";
      for (let i = 0; i < n.max; i++) {
        ctx.fillStyle = i < n.coque ? couleur : "rgba(10, 10, 10, 0.55)";
        ctx.fillRect(x - tot / 2 + i * (larg + esp), y + 0.72, larg, 0.1);
      }
    }
  }

  private navire(classe: Classe, x: number, y: number, angle: number, o: {
    pav?: PavillonId; alpha: number; mien: boolean; t: number; ratio: number; selection?: boolean;
    contour?: boolean; coule?: number; graine?: number;
  }) {
    const ctx = this.ctx;
    const p = PAVILLONS[o.pav || "ancre"];
    const L = classe === "eclaireur" ? 1.12 : classe === "fregate" ? 1.42 : 1.5;
    const B = classe === "eclaireur" ? 0.36 : classe === "fregate" ? 0.48 : 0.62;
    const roulis = o.coule ? 0 : Math.sin(o.t * 1.6 + (o.graine || 0)) * 0.035;
    ctx.save();
    ctx.globalAlpha = o.alpha;
    ctx.translate(x, y);
    // Anneau de camp (au sol, non tourné).
    ctx.beginPath();
    ctx.ellipse(0, 0.05, 0.86, 0.6, 0, 0, 7);
    ctx.strokeStyle = o.mien ? "rgba(243, 215, 142, 0.55)" : p.couleur + "88";
    ctx.lineWidth = 0.045;
    ctx.stroke();
    if (o.selection) {
      ctx.save();
      ctx.rotate(o.t * 0.8);
      ctx.setLineDash([0.22, 0.14]);
      ctx.strokeStyle = "#f3d78e";
      ctx.lineWidth = 0.07;
      ctx.beginPath();
      ctx.arc(0, 0, 0.95, 0, 7);
      ctx.stroke();
      ctx.restore();
    }
    ctx.rotate(angle + roulis);
    if (o.coule) {
      ctx.rotate(o.coule * 0.5);
      ctx.scale(1 - o.coule * 0.35, 1 - o.coule * 0.35);
    }
    // Ombre portée.
    ctx.save();
    ctx.translate(0.06, 0.1);
    ctx.fillStyle = "rgba(0, 12, 20, 0.35)";
    this.coque(L, B);
    ctx.fill();
    ctx.restore();
    // Coque.
    const g = ctx.createLinearGradient(0, -B / 2, 0, B / 2);
    g.addColorStop(0, "#7a4d27");
    g.addColorStop(0.5, "#5a3518");
    g.addColorStop(1, "#3a210d");
    ctx.fillStyle = g;
    this.coque(L, B);
    ctx.fill();
    ctx.strokeStyle = o.contour && o.alpha < 0.5 ? p.couleur : "#1c0f05";
    ctx.lineWidth = 0.04;
    ctx.stroke();
    // Pont et bordé à la couleur du royaume.
    ctx.save();
    ctx.scale(0.8, 0.72);
    ctx.fillStyle = "#94683b";
    this.coque(L, B);
    ctx.fill();
    ctx.strokeStyle = p.couleur;
    ctx.lineWidth = 0.05;
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = "rgba(40, 20, 6, 0.45)";
    ctx.lineWidth = 0.015;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(-L * 0.36, i * B * 0.09);
      ctx.lineTo(L * 0.28, i * B * 0.09);
      ctx.stroke();
    }
    // Pièces d'artillerie.
    ctx.fillStyle = "#1e1e1e";
    if (classe === "fregate") {
      for (const xx of [-0.3, -0.05, 0.2]) {
        ctx.fillRect(xx, -B / 2 - 0.06, 0.1, 0.09);
        ctx.fillRect(xx, B / 2 - 0.03, 0.1, 0.09);
      }
    } else if (classe === "siege") {
      ctx.beginPath();
      ctx.arc(L * 0.18, 0, 0.17, 0, 7);
      ctx.fillStyle = "#3a3a3a";
      ctx.fill();
      ctx.fillStyle = "#151515";
      ctx.beginPath();
      ctx.arc(L * 0.18, 0, 0.09, 0, 7);
      ctx.fill();
      ctx.fillStyle = "#6d4a24";
      ctx.fillRect(L * 0.18 - 0.04, -0.27, 0.08, 0.54);
    }
    // Mâts et voiles (vues de dessus : vergues en travers, toile gonflée).
    const mats = classe === "eclaireur" ? [0.02] : classe === "fregate" ? [0.28, -0.2] : [-0.32];
    const vent = this.scene?.meteo ? angleCap(this.scene.meteo.vent) - angle : 0;
    const gonfle = Math.cos(vent) * 0.07;
    for (const mx of mats) {
      ctx.fillStyle = "#e9dcbc";
      ctx.strokeStyle = "rgba(60, 40, 20, 0.6)";
      ctx.lineWidth = 0.02;
      ctx.beginPath();
      ctx.moveTo(mx - 0.04, -B * 0.72);
      ctx.quadraticCurveTo(mx + 0.08 + gonfle, 0, mx - 0.04, B * 0.72);
      ctx.lineTo(mx - 0.13, B * 0.62);
      ctx.quadraticCurveTo(mx - 0.02 + gonfle, 0, mx - 0.13, -B * 0.62);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = p.couleur;
      ctx.fillRect(mx - 0.1, -0.05, 0.08, 0.1);
      ctx.fillStyle = "#3b2410";
      ctx.beginPath();
      ctx.arc(mx - 0.06, 0, 0.04, 0, 7);
      ctx.fill();
    }
    if (classe === "eclaireur") {      // foc triangulaire
      ctx.fillStyle = "#ddcfae";
      ctx.beginPath();
      ctx.moveTo(L * 0.48, 0);
      ctx.lineTo(L * 0.12, -0.1);
      ctx.lineTo(L * 0.12, 0.1);
      ctx.fill();
    }
    // Pavillon de poupe, qui flotte.
    const f = Math.sin(o.t * 6 + (o.graine || 0)) * 0.04;
    ctx.fillStyle = p.couleur;
    ctx.beginPath();
    ctx.moveTo(-L / 2 + 0.05, 0);
    ctx.lineTo(-L / 2 - 0.28, -0.1 + f);
    ctx.lineTo(-L / 2 - 0.22, 0.02 + f);
    ctx.lineTo(-L / 2 - 0.3, 0.12 + f);
    ctx.closePath();
    ctx.fill();
    // Dégâts : brûlures.
    if (o.ratio < 0.7) {
      const n = o.ratio < 0.35 ? 4 : 2;
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = "rgba(20, 10, 5, 0.6)";
        ctx.beginPath();
        ctx.arc((hache(i, o.graine || 1, 3) - 0.5) * L * 0.6, (hache(i, o.graine || 1, 4) - 0.5) * B * 0.5,
          0.06 + hache(i, 2, o.graine || 1) * 0.06, 0, 7);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private coque(L: number, B: number) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(L / 2, 0);
    ctx.quadraticCurveTo(L * 0.3, -B / 2, -L * 0.1, -B / 2);
    ctx.lineTo(-L / 2 + 0.06, -B * 0.44);
    ctx.quadraticCurveTo(-L / 2 - 0.04, 0, -L / 2 + 0.06, B * 0.44);
    ctx.lineTo(-L * 0.1, B / 2);
    ctx.quadraticCurveTo(L * 0.3, B / 2, L / 2, 0);
    ctx.closePath();
  }

  // ── effets de la résolution ──
  private dessinerEffets(ta: number) {
    const ctx = this.ctx, a = this.anim!, reduit = !!this.scene?.reduit;
    for (const e of a.effets) {
      const dt = ta - e.t;
      if (dt < 0) continue;
      const vers = e.vers ? centre(e.vers) : null;
      const de = e.de ? centre(e.de) : null;
      if (e.type === "tir") {
        const vol = reduit ? 0 : 0.6;
        if (de && dt < 0.25 && !reduit) {             // éclair du départ
          const k = dt / 0.25;
          const g = ctx.createRadialGradient(de[0], de[1], 0, de[0], de[1], 0.7);
          g.addColorStop(0, `rgba(255, 230, 160, ${0.9 * (1 - k)})`);
          g.addColorStop(1, "rgba(255, 140, 40, 0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(de[0], de[1], 0.7, 0, 7);
          ctx.fill();
        }
        if (de && vers && dt < vol) {                  // boulet en cloche (ombre + projectile)
          const k = dt / vol;
          const x = lerp(de[0], vers[0], k), y = lerp(de[1], vers[1], k);
          const haut = Math.sin(Math.PI * k) * Math.min(1.6, Math.hypot(vers[0] - de[0], vers[1] - de[1]) * 0.22);
          ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
          ctx.beginPath();
          ctx.arc(x, y, 0.07, 0, 7);
          ctx.fill();
          ctx.fillStyle = "#1a1a1a";
          ctx.beginPath();
          ctx.arc(x, y - haut, 0.09 + haut * 0.04, 0, 7);
          ctx.fill();
        }
        if (vers && dt >= vol && dt < vol + 1.6) {
          const k = (dt - vol) / (reduit ? 2.4 : 0.9);
          const ox = e.touche ? 0 : (hache(e.graine, 1, 1) - 0.5) * 0.9, oy = e.touche ? 0 : (hache(e.graine, 2, 1) - 0.5) * 0.9;
          const [x, y] = [vers[0] + ox, vers[1] + oy];
          if (k < 1) {
            if (e.touche) {
              const r = (e.critique ? 1.0 : 0.7) * (reduit ? 1 : doux(k * 3));
              const g = ctx.createRadialGradient(x, y, 0, x, y, r);
              g.addColorStop(0, `rgba(255, 235, 170, ${0.95 * (1 - k)})`);
              g.addColorStop(0.45, `rgba(240, 120, 40, ${0.8 * (1 - k)})`);
              g.addColorStop(1, "rgba(120, 40, 10, 0)");
              ctx.fillStyle = g;
              ctx.beginPath();
              ctx.arc(x, y, r, 0, 7);
              ctx.fill();
            } else if (e.touche === false) {
              ctx.strokeStyle = `rgba(235, 250, 255, ${0.8 * (1 - k)})`;
              ctx.lineWidth = 0.05;
              ctx.beginPath();
              ctx.arc(x, y, 0.15 + (reduit ? 0.3 : k * 0.55), 0, 7);
              ctx.stroke();
              ctx.fillStyle = `rgba(235, 250, 255, ${0.6 * (1 - k)})`;
              ctx.beginPath();
              ctx.arc(x, y, 0.12, 0, 7);
              ctx.fill();
            }
          }
          const kt = (dt - vol) / 1.6;
          const texte = e.touche ? (e.critique ? `−${e.degats} coup au but !` : `−${e.degats}`)
            : e.touche === false ? "manqué" : "";
          if (texte) this.etiquette(texte, vers[0], vers[1] - 0.6 - (reduit ? 0 : kt * 0.6),
            e.touche ? "#ffb4a1" : "#d6ecf5", 1 - Math.max(0, kt - 0.6) / 0.4, e.critique ? 0.42 : 0.34);
        }
      } else if (vers && dt < 1.6) {
        const k = dt / 1.6;
        const y = vers[1] - 0.6 - (reduit ? 0 : k * 0.5);
        const fondu = 1 - Math.max(0, k - 0.6) / 0.4;
        if (e.type === "choc") this.etiquette(`choc −${e.degats ?? 1}`, vers[0], y, "#ffcf9e", fondu);
        if (e.type === "recif") this.etiquette(`récif −${e.degats ?? 1}`, vers[0], y, "#cfe8ef", fondu);
        if (e.type === "reparation") this.etiquette("+1 réparé", vers[0], y, "#a6e39a", fondu);
        if (e.type === "coule" && !reduit) {
          ctx.strokeStyle = `rgba(220, 240, 250, ${0.6 * (1 - k)})`;
          ctx.lineWidth = 0.04;
          for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.arc(vers[0], vers[1], 0.3 + k * (0.6 + i * 0.35), 0, 7);
            ctx.stroke();
          }
        }
      }
    }
  }

  private etiquette(texte: string, x: number, y: number, couleur: string, alpha = 1, taille = 0.3) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.font = `600 ${taille}px ${this.police}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 0.08;
    ctx.strokeStyle = "rgba(4, 10, 16, 0.85)";
    ctx.strokeText(texte, x, y);
    ctx.fillStyle = couleur;
    ctx.fillText(texte, x, y);
    ctx.restore();
  }
}
