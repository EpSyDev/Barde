// Piste de dés 3D : Three.js (rendu) + cannon-es (physique).
//
// Le résultat n'est JAMAIS décidé ici : le serveur (moteur de dés de La Fripouille) tire
// les valeurs, puis on :
//   1. simule le lancer en entier hors écran (pas fixe, déterministe) en enregistrant
//      chaque image ;
//   2. lit la face (ou le sommet, pour le d4) qui finit en haut ;
//   3. échange les numéros de faces pour que cette face porte la valeur tirée ;
//   4. rejoue l'enregistrement à l'écran.
// Rebonds réels, résultat imposé : rien à truquer côté navigateur.

import * as THREE from "three";
import * as CANNON from "cannon-es";

export type Faces = 4 | 6 | 8 | 10 | 12 | 20 | 100;
export type DeTire = { faces: Faces; v: number; garde: boolean };

// ─────────────────────────── Couleurs (reprises du dashboard) ───────────────────────────
const TEINTES: Record<number, { fond: string; encre: string }> = {
  4: { fond: "#b5523b", encre: "#f6ead2" },
  6: { fond: "#e7dabb", encre: "#2d1f10" },
  8: { fond: "#5f80a6", encre: "#f6ead2" },
  10: { fond: "#7f9f58", encre: "#f6ead2" },
  12: { fond: "#8a5fa0", encre: "#f6ead2" },
  20: { fond: "#c9a44a", encre: "#2d1f10" },
  100: { fond: "#d8cdb6", encre: "#2d1f10" },
};

// ─────────────────────────── Géométrie des dés ───────────────────────────
type FaceLogique = { normale: THREE.Vector3; sommets: number[]; centre: THREE.Vector3 };
type Forme = { sommets: THREE.Vector3[]; faces: FaceLogique[]; rayon: number };

/** d10 : trapézoèdre pentagonal (10 cerfs-volants plans). */
function soupeD10(h: number): THREE.BufferGeometry {
  const a = (h * (1 - Math.cos(Math.PI / 5))) / (1 + Math.cos(Math.PI / 5)); // planéité des faces
  const haut = new THREE.Vector3(0, h, 0);
  const bas = new THREE.Vector3(0, -h, 0);
  const anneau = Array.from({ length: 10 }, (_, i) => {
    const ang = (i * Math.PI) / 5;
    return new THREE.Vector3(Math.cos(ang), i % 2 === 0 ? a : -a, Math.sin(ang));
  });
  const tri: THREE.Vector3[] = [];
  const kite = (p: THREE.Vector3[]) => tri.push(p[0], p[1], p[2], p[0], p[2], p[3]);
  for (let k = 0; k < 5; k++) {
    const r = (i: number) => anneau[(i + 10) % 10];
    kite([haut, r(2 * k), r(2 * k + 1), r(2 * k + 2)]);
    kite([bas, r(2 * k + 1), r(2 * k + 2), r(2 * k + 3)]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(tri.flatMap((v) => [v.x, v.y, v.z]), 3));
  return g;
}

function soupe(faces: Faces): THREE.BufferGeometry {
  switch (faces) {
    case 4: return new THREE.TetrahedronGeometry(1.15).toNonIndexed();
    case 6: return new THREE.BoxGeometry(1.35, 1.35, 1.35).toNonIndexed();
    case 8: return new THREE.OctahedronGeometry(1.05).toNonIndexed();
    case 10: case 100: return soupeD10(1.0);
    case 12: return new THREE.DodecahedronGeometry(1.0).toNonIndexed();
    default: return new THREE.IcosahedronGeometry(1.05).toNonIndexed();
  }
}

const cacheFormes = new Map<number, Forme>();

/** Regroupe les triangles coplanaires en faces logiques (sommets ordonnés CCW vus de dehors). */
function forme(faces: Faces): Forme {
  const k = faces === 100 ? 10 : faces;
  const deja = cacheFormes.get(k);
  if (deja) return deja;
  const pos = soupe(faces).getAttribute("position");
  const sommets: THREE.Vector3[] = [];
  const idx = (v: THREE.Vector3) => {
    let i = sommets.findIndex((s) => s.distanceToSquared(v) < 1e-6);
    if (i < 0) i = sommets.push(v.clone()) - 1;
    return i;
  };
  const groupes: { n: THREE.Vector3; ids: Set<number> }[] = [];
  for (let t = 0; t < pos.count; t += 3) {
    const [a, b, c] = [0, 1, 2].map((j) => new THREE.Vector3().fromBufferAttribute(pos, t + j));
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    const centreTri = new THREE.Vector3().add(a).add(b).add(c).divideScalar(3);
    if (n.dot(centreTri) < 0) n.negate();
    let g = groupes.find((x) => x.n.dot(n) > 0.999);
    if (!g) groupes.push((g = { n, ids: new Set() }));
    [a, b, c].forEach((v) => g!.ids.add(idx(v)));
  }
  const facesL: FaceLogique[] = groupes.map(({ n, ids }) => {
    const liste = [...ids];
    const centre = liste.reduce((acc, i) => acc.add(sommets[i]), new THREE.Vector3()).divideScalar(liste.length);
    const t = new THREE.Vector3().subVectors(sommets[liste[0]], centre).normalize();
    const b = new THREE.Vector3().crossVectors(n, t);
    liste.sort((i, j) => {
      const p = sommets[i].clone().sub(centre), q = sommets[j].clone().sub(centre);
      return Math.atan2(p.dot(b), p.dot(t)) - Math.atan2(q.dot(b), q.dot(t));
    });
    return { normale: n, sommets: liste, centre };
  });
  const rayon = Math.max(...sommets.map((s) => s.length()));
  const f = { sommets, faces: facesL, rayon };
  cacheFormes.set(k, f);
  return f;
}

// ─────────────────────────── Textures numérotées ───────────────────────────
let police = "serif";
export function definirPolice(famille: string) {
  if (famille) police = famille;
}

function etiquettes(faces: Faces, role: "seul" | "dizaine" | "unite"): string[] {
  const n = faces === 100 ? 10 : faces;
  if (n === 10) {
    if (role === "dizaine") return Array.from({ length: 10 }, (_, i) => (i === 0 ? "00" : `${i}0`));
    return Array.from({ length: 10 }, (_, i) => String(i));
  }
  return Array.from({ length: n }, (_, i) => String(i + 1));
}

function texte(ctx: CanvasRenderingContext2D, t: string, x: number, y: number, taille: number, encre: string, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.font = `700 ${taille}px ${police}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = encre;
  ctx.fillText(t, 0, taille * 0.04);
  if (t === "6" || t === "9") {
    const w = ctx.measureText(t).width;
    ctx.fillRect(-w / 2, taille * 0.42, w, taille * 0.07);
  }
  ctx.restore();
}

function toile(fond: string): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = fond;
  ctx.fillRect(0, 0, 256, 256);
  // grain léger : la matière n'a pas l'air de plastique lisse
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(${Math.random() < 0.5 ? "0,0,0" : "255,255,255"},${Math.random() * 0.05})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  return [c, ctx];
}

function finirTexture(c: HTMLCanvasElement) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ─────────────────────────── Un dé ───────────────────────────
type UV = { u: THREE.Vector3; d: THREE.Vector3; portee: number };

class De {
  readonly corps: CANNON.Body;
  readonly maillage: THREE.Mesh;
  readonly faces: Faces;
  readonly role: "seul" | "dizaine" | "unite";
  private forme: Forme;
  private reperes: UV[];
  /** labels[i] = texte de la face i (ou du sommet i pour le d4). */
  labels: string[];

  constructor(faces: Faces, role: "seul" | "dizaine" | "unite", matiere: CANNON.Material) {
    this.faces = faces;
    this.role = role;
    this.forme = forme(faces);
    const f = this.forme;
    this.labels = etiquettes(faces, role);
    if (faces === 4) this.labels = this.labels.slice(0, f.sommets.length);

    // Repère de texture par face : « haut » vers le sommet le plus éloigné du centre.
    this.reperes = f.faces.map((fa) => {
      let loin = f.sommets[fa.sommets[0]];
      for (const i of fa.sommets) if (f.sommets[i].distanceTo(fa.centre) > loin.distanceTo(fa.centre) + 1e-6) loin = f.sommets[i];
      // d6 : chiffre droit, aligné sur une arête (pas en diagonale vers un coin)
      if (faces === 6) loin = f.sommets[fa.sommets[0]].clone().add(f.sommets[fa.sommets[1]]).multiplyScalar(0.5);
      const haut = loin.clone().sub(fa.centre).normalize();
      const droite = new THREE.Vector3().crossVectors(haut, fa.normale).normalize();
      const portee = Math.max(...fa.sommets.map((i) => f.sommets[i].distanceTo(fa.centre))) * 2.05;
      return { u: droite, d: haut, portee };
    });

    // Géométrie : chaque face logique = un groupe (un matériau), UV projetées sur sa face.
    const p: number[] = [], n: number[] = [], uv: number[] = [];
    const geo = new THREE.BufferGeometry();
    let debut = 0;
    f.faces.forEach((fa, i) => {
      const r = this.reperes[i];
      const s = fa.sommets.map((k) => f.sommets[k]);
      for (let j = 1; j < s.length - 1; j++) {
        for (const v of [s[0], s[j], s[j + 1]]) {
          p.push(v.x, v.y, v.z);
          n.push(fa.normale.x, fa.normale.y, fa.normale.z);
          const q = v.clone().sub(fa.centre);
          uv.push(0.5 + q.dot(r.u) / r.portee, 0.5 + q.dot(r.d) / r.portee);
        }
      }
      const nb = (s.length - 2) * 3;
      geo.addGroup(debut, nb, i);
      debut += nb;
    });
    geo.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(n, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    this.maillage = new THREE.Mesh(geo, []);
    this.maillage.castShadow = true;
    this.peindre();

    this.corps = new CANNON.Body({
      mass: 1,
      material: matiere,
      shape: new CANNON.ConvexPolyhedron({
        vertices: f.sommets.map((v) => new CANNON.Vec3(v.x, v.y, v.z)),
        faces: f.faces.map((fa) => fa.sommets),
      }),
      allowSleep: true,
      sleepSpeedLimit: 0.15,
      sleepTimeLimit: 0.35,
      angularDamping: 0.12,
      linearDamping: 0.08,
    });
  }

  /** (Re)crée les matériaux d'après les étiquettes courantes. */
  peindre() {
    const { fond, encre } = TEINTES[this.faces];
    const f = this.forme;
    const anciens = this.maillage.material as THREE.MeshStandardMaterial[];
    anciens.forEach((m) => { m.map?.dispose(); m.dispose(); });
    this.maillage.material = f.faces.map((fa, i) => {
      const [c, ctx] = toile(fond);
      const r = this.reperes[i];
      if (this.faces === 4) {
        // d4 : un chiffre à chaque coin, tête vers le coin ; on lit celui du sommet du haut.
        for (const k of fa.sommets) {
          const q = f.sommets[k].clone().sub(fa.centre);
          const x = (0.5 + (q.dot(r.u) / r.portee) * 0.62) * 256;
          const y = (0.5 - (q.dot(r.d) / r.portee) * 0.62) * 256;
          const rot = Math.atan2(q.dot(r.u), q.dot(r.d));
          texte(ctx, this.labels[k], x, y, 44, encre, rot);
        }
      } else {
        const t = this.labels[i];
        // Taille calée sur le cercle inscrit de chaque forme (le chiffre ne déborde pas).
        const base: Record<number, [number, number]> = {
          6: [104, 84], 8: [78, 60], 10: [70, 54], 100: [70, 50], 12: [80, 62], 20: [66, 50],
        };
        const [un, deux] = base[this.faces] ?? [80, 60];
        const taille = t.length >= 2 ? deux : un;
        texte(ctx, t, 128, this.faces === 10 || this.faces === 100 ? 140 : 128, taille, encre);
      }
      return new THREE.MeshStandardMaterial({ map: finirTexture(c), roughness: 0.45, metalness: 0.05 });
    });
  }

  /** Indice (face, ou sommet pour le d4) qui regarde vers le haut. */
  dessus(q: CANNON.Quaternion): number {
    const quat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
    const liste = this.faces === 4 ? this.forme.sommets.map((s) => s.clone().normalize()) : this.forme.faces.map((fa) => fa.normale);
    let meilleur = 0, y = -Infinity;
    liste.forEach((v, i) => {
      const w = v.clone().applyQuaternion(quat).y;
      if (w > y) { y = w; meilleur = i; }
    });
    return meilleur;
  }

  /** Impose l'étiquette `cible` sur l'indice `i` (échange avec celui qui la portait). */
  imposer(i: number, cible: string) {
    const j = this.labels.indexOf(cible);
    if (j < 0 || j === i) return;
    [this.labels[i], this.labels[j]] = [this.labels[j], this.labels[i]];
  }

  eclat(couleur: number | null, ecarte = false) {
    for (const m of this.maillage.material as THREE.MeshStandardMaterial[]) {
      m.emissive = new THREE.Color(couleur ?? 0x000000);
      m.emissiveIntensity = couleur ? 0.55 : 0;
      m.transparent = ecarte;
      m.opacity = ecarte ? 0.45 : 1;
    }
  }

  liberer() {
    this.maillage.geometry.dispose();
    (this.maillage.material as THREE.MeshStandardMaterial[]).forEach((m) => { m.map?.dispose(); m.dispose(); });
  }
}

// ─────────────────────────── La piste ───────────────────────────
const LARG = 15, PROF = 9; // dimensions du tapis
const PAS = 1 / 60;

export class PisteDes3D {
  private rendu: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private monde = new CANNON.World({ gravity: new CANNON.Vec3(0, -38, 0) });
  private matDe = new CANNON.Material("de");
  private des: De[] = [];
  private film: { p: number[]; q: number[] }[][] = []; // film[image][de]
  private lecture = 0;
  private fini: (() => void) | null = null;
  private horloge = new THREE.Clock();
  private raf = 0;
  private observateur: ResizeObserver;

  constructor(private hote: HTMLElement) {
    this.rendu = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.rendu.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.rendu.shadowMap.enabled = true;
    this.rendu.shadowMap.type = THREE.PCFSoftShadowMap;
    this.rendu.outputColorSpace = THREE.SRGBColorSpace;
    this.rendu.toneMapping = THREE.ACESFilmicToneMapping;
    hote.appendChild(this.rendu.domElement);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.camera.position.set(0, 17, 9.5);
    this.camera.lookAt(0, 0, 0.6);

    this.decor();
    this.physique();
    this.observateur = new ResizeObserver(() => this.taille());
    this.observateur.observe(hote);
    this.taille();
    this.boucle();
  }

  private decor() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0xffe9c4, 0x2a1607, 0.75));
    const lampe = new THREE.DirectionalLight(0xffd59a, 2.1);
    lampe.position.set(-6, 14, 6);
    lampe.castShadow = true;
    lampe.shadow.mapSize.set(2048, 2048);
    Object.assign(lampe.shadow.camera, { left: -10, right: 10, top: 8, bottom: -8 });
    lampe.shadow.bias = -0.0004;
    s.add(lampe);
    const braise = new THREE.PointLight(0xe07a33, 18, 22);
    braise.position.set(7, 4, -5);
    s.add(braise);

    // Tapis de feutre bordeaux (texture procédurale) dans un cadre de bois.
    const [c, ctx] = toile("#5a1d1a");
    const grad = ctx.createRadialGradient(128, 128, 20, 128, 128, 190);
    grad.addColorStop(0, "rgba(255,170,120,0.10)");
    grad.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
    const feutre = finirTexture(c);
    const tapis = new THREE.Mesh(
      new THREE.PlaneGeometry(LARG, PROF),
      new THREE.MeshStandardMaterial({ map: feutre, roughness: 0.95 })
    );
    tapis.rotation.x = -Math.PI / 2;
    tapis.receiveShadow = true;
    s.add(tapis);

    const bois = new THREE.MeshStandardMaterial({ color: 0x4a2c12, roughness: 0.7, metalness: 0.05 });
    const bord = (w: number, d: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, d), bois);
      m.position.set(x, 0.45, z);
      m.castShadow = m.receiveShadow = true;
      s.add(m);
    };
    bord(LARG + 1.2, 0.6, 0, -PROF / 2 - 0.3);
    bord(LARG + 1.2, 0.6, 0, PROF / 2 + 0.3);
    bord(0.6, PROF, -LARG / 2 - 0.3, 0);
    bord(0.6, PROF, LARG / 2 + 0.3, 0);
  }

  private physique() {
    const w = this.monde;
    w.allowSleep = true;
    (w.solver as CANNON.GSSolver).iterations = 14;
    const matSol = new CANNON.Material("sol");
    const matMur = new CANNON.Material("mur");
    w.addContactMaterial(new CANNON.ContactMaterial(this.matDe, matSol, { friction: 0.22, restitution: 0.32 }));
    w.addContactMaterial(new CANNON.ContactMaterial(this.matDe, matMur, { friction: 0.05, restitution: 0.55 }));
    w.addContactMaterial(new CANNON.ContactMaterial(this.matDe, this.matDe, { friction: 0.12, restitution: 0.4 }));
    const sol = new CANNON.Body({ mass: 0, material: matSol, shape: new CANNON.Plane() });
    sol.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    w.addBody(sol);
    const mur = (x: number, z: number, ry: number) => {
      const b = new CANNON.Body({ mass: 0, material: matMur, shape: new CANNON.Plane() });
      b.quaternion.setFromEuler(0, ry, 0);
      b.position.set(x, 0, z);
      w.addBody(b);
    };
    mur(0, -PROF / 2, 0);              // fond (normale +z)
    mur(0, PROF / 2, Math.PI);         // devant
    mur(-LARG / 2, 0, Math.PI / 2);    // gauche
    mur(LARG / 2, 0, -Math.PI / 2);    // droite
    // plafond invisible : aucun dé ne s'échappe de la piste
    const toit = new CANNON.Body({ mass: 0, material: matMur, shape: new CANNON.Plane() });
    toit.quaternion.setFromEuler(Math.PI / 2, 0, 0);
    toit.position.set(0, 9, 0);
    w.addBody(toit);
  }

  private taille() {
    const { clientWidth: w, clientHeight: h } = this.hote;
    if (!w || !h) return;
    this.rendu.setSize(w, h, false);
    this.camera.aspect = w / h;
    // garde toute la piste dans le cadre, même en portrait
    this.camera.position.set(0, 17 * Math.max(1, 1.45 / this.camera.aspect), 9.5 * Math.max(1, 1.45 / this.camera.aspect));
    this.camera.lookAt(0, 0, 0.6);
    this.camera.updateProjectionMatrix();
  }

  private vider() {
    for (const d of this.des) {
      this.monde.removeBody(d.corps);
      this.scene.remove(d.maillage);
      d.liberer();
    }
    this.des = [];
  }

  /** Lance les dés tirés par le serveur ; la promesse se résout quand tout est posé. */
  lancer(tires: DeTire[], nat: number | null): Promise<void> {
    this.vider();
    // d100 = deux d10 (dizaine + unité), comme à la table.
    const plan: { de: De; cible: string; source: DeTire }[] = [];
    for (const t of tires.slice(0, 14)) {
      if (t.faces === 100) {
        const dz = Math.floor((t.v % 100) / 10), u = t.v % 10;
        plan.push({ de: new De(100, "dizaine", this.matDe), cible: dz === 0 ? "00" : `${dz}0`, source: t });
        plan.push({ de: new De(100, "unite", this.matDe), cible: String(u), source: t });
      } else if (t.faces === 10) {
        plan.push({ de: new De(10, "seul", this.matDe), cible: String(t.v % 10), source: t });
      } else {
        plan.push({ de: new De(t.faces, "seul", this.matDe), cible: String(t.v), source: t });
      }
    }
    // Lancer depuis la gauche, en éventail, avec du spin.
    plan.forEach(({ de }, i) => {
      const b = de.corps;
      b.position.set(-LARG / 2 + 1.4 + Math.random() * 1.2, 2.2 + (i % 4) * 0.9, -PROF / 2 + 1.6 + ((i * 1.7) % (PROF - 3.2)));
      b.quaternion.setFromEuler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
      b.velocity.set(13 + Math.random() * 7, 2 + Math.random() * 3, (Math.random() - 0.5) * 9);
      b.angularVelocity.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
      this.monde.addBody(b);
      this.des.push(de);
    });

    // 1) Simulation complète hors écran, enregistrée.
    this.film = [];
    for (let k = 0; k < 420; k++) {
      this.monde.step(PAS);
      this.film.push(this.des.map((d) => ({
        p: [d.corps.position.x, d.corps.position.y, d.corps.position.z],
        q: [d.corps.quaternion.x, d.corps.quaternion.y, d.corps.quaternion.z, d.corps.quaternion.w],
      })));
      if (k > 30 && this.des.every((d) => d.corps.sleepState === CANNON.Body.SLEEPING)) break;
    }
    // 2-3) Face du dessus → étiquette imposée par le serveur.
    plan.forEach(({ de, cible }) => {
      const dernier = this.film[this.film.length - 1][this.des.indexOf(de)].q;
      de.imposer(de.dessus(new CANNON.Quaternion(dernier[0], dernier[1], dernier[2], dernier[3])), cible);
      de.peindre();
      this.scene.add(de.maillage);
    });
    // 4) Lecture.
    this.lecture = 0;
    this.horloge.getDelta();
    return new Promise((ok) => {
      this.fini = () => {
        plan.forEach(({ de, source }) => {
          if (!source.garde) de.eclat(null, true);
          else if (source.faces === 20 && nat === 20 && source.v === 20) de.eclat(0xffc24a);
          else if (source.faces === 20 && nat === 1 && source.v === 1) de.eclat(0xd0301e);
        });
        ok();
      };
    });
  }

  private boucle = () => {
    this.raf = requestAnimationFrame(this.boucle);
    const dt = Math.min(this.horloge.getDelta(), 0.1);
    if (this.film.length && this.lecture < this.film.length) {
      this.lecture = Math.min(this.film.length - 1 + 1e-6, this.lecture + dt / PAS);
      const img = this.film[Math.floor(this.lecture)];
      img.forEach((e, i) => {
        this.des[i].maillage.position.set(e.p[0], e.p[1], e.p[2]);
        this.des[i].maillage.quaternion.set(e.q[0], e.q[1], e.q[2], e.q[3]);
      });
      if (this.lecture >= this.film.length - 1 && this.fini) {
        const f = this.fini;
        this.fini = null;
        f();
      }
    }
    this.rendu.render(this.scene, this.camera);
  };

  /** Outil de vérification (dev) : vue de dessus + valeurs lues sur les dés posés. */
  inspecter() {
    this.camera.position.set(0, 22, 0.01);
    this.camera.lookAt(0, 0, 0);
    return this.des.map((d) => {
      const q = d.maillage.quaternion;
      return `${d.faces}${d.role === "seul" ? "" : ":" + d.role} → ${d.labels[d.dessus(new CANNON.Quaternion(q.x, q.y, q.z, q.w))]}`;
    });
  }

  detruire() {
    cancelAnimationFrame(this.raf);
    this.observateur.disconnect();
    this.vider();
    this.rendu.dispose();
    this.rendu.domElement.remove();
  }
}
