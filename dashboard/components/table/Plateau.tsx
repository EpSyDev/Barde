"use client";

// Plateau de jeu partagé (table virtuelle D&D).
// L'état vit dans La Fripouille ; on s'y branche en direct (flux SSE) avec un ticket de
// soirée délivré par /api/table/plateau. Chaque geste part en POST sur le même ticket et
// revient à tous les navigateurs ouverts par le flux.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MediaPicker from "@/components/MediaPicker";
import { AmbianceSonore, type Son } from "@/lib/ambiance-sonore";
import { TUILES } from "@/lib/meteo";
import { BESTIAIRE, CLASSES, COULEURS_HEROS, SCENES, type Classe, type Creature, type Scene } from "@/lib/scenes";

const CASE = 64; // px par case dans le « monde » (avant zoom)
const METRES_PAR_CASE = 1.5;
const ETATS = ["À terre", "Empoisonné", "Étourdi", "Entravé", "Invisible", "Concentration", "Inconscient"];
const DES = [4, 6, 8, 10, 12, 20, 100];
const COULEURS: Record<TypePion, string> = { joueur: "#5f80a6", monstre: "#c25340", pnj: "#c9a44a" };

type TypePion = "joueur" | "monstre" | "pnj";
type Pion = {
  id: string; nom: string; type: TypePion; couleur: string; taille: number; x: number; y: number;
  pv: number | null; pv_max: number | null; image_url: string; cache: boolean; etats: string[];
  icone?: string;
};
type Jet = {
  id: string; qui: string; raison: string; expr: string; total: number; nat: number | null;
  lignes: string[]; cache: boolean; heure: number;
};
type Etat = {
  version: number;
  carte: { image_url: string; cols: number; rows: number; quadrillage: boolean };
  pions: Pion[];
  brouillard: { actif: boolean; reveles: number[][] };
  fil: Jet[];
  scene?: { id: string; nom: string; lumieres: number[][] };
  ambiance?: { lumiere: "jour" | "crepuscule" | "nuit"; meteo: string; son: Son };
};
type Urls = { flux_url: string; op_url: string; etat_url: string };
type Outil = "main" | "regle" | "reveler" | "masquer" | "ping";
type Ping = { id: number; x: number; y: number; qui: string; couleur: string };

const LUMIERES = [
  { id: "jour", label: "☀️ Jour" }, { id: "crepuscule", label: "🌇 Crépuscule" }, { id: "nuit", label: "🌙 Nuit" },
] as const;
const METEOS = [
  { id: "aucune", label: "Dégagé" }, { id: "pluie", label: "🌧️ Pluie" }, { id: "neige", label: "❄️ Neige" },
  { id: "brume", label: "🌫️ Brume" }, { id: "braises", label: "🔥 Braises" },
] as const;
const SONS: { id: Son; label: string }[] = [
  { id: "taverne", label: "🍺 Taverne" }, { id: "crypte", label: "🕯️ Crypte" }, { id: "foret", label: "🌲 Forêt" },
  { id: "camp", label: "🏕️ Feu de camp" }, { id: "pluie", label: "🌧️ Pluie" }, { id: "aucun", label: "Silence" },
];
const TORCHE = 5; // rayon de lumière autour d'un héros la nuit (cases)

const OUTILS: { id: Outil; label: string; icone: string; aide: string }[] = [
  { id: "main", label: "Déplacer", icone: "✋", aide: "Glisser un pion · glisser le fond pour bouger la vue · molette = zoom" },
  { id: "regle", label: "Règle", icone: "📏", aide: "Glisser pour mesurer (1 case = 1,5 m, diagonale = 1 case)" },
  { id: "ping", label: "Ping", icone: "📍", aide: "Cliquer pour montrer un endroit à toute la table (ou double-clic)" },
  { id: "reveler", label: "Révéler", icone: "🔦", aide: "Glisser un rectangle pour dissiper le brouillard" },
  { id: "masquer", label: "Masquer", icone: "🌫️", aide: "Glisser un rectangle pour remettre le brouillard" },
];

function initiales(nom: string) {
  return nom.split(/\s+/).filter(Boolean).slice(0, 2).map((m) => m[0]).join("").toUpperCase() || "?";
}

function Ligne({ texte }: { texte: string }) {
  return (
    <>
      {texte.split(/(\*\*[^*]+\*\*|~~[^~]+~~|`[^`]+`)/g).map((p, i) =>
        p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b>
        : p.startsWith("~~") ? <s key={i}>{p.slice(2, -2)}</s>
        : p.startsWith("`") ? <code key={i}>{p.slice(1, -1)}</code>
        : <span key={i}>{p}</span>
      )}
    </>
  );
}

export default function Plateau() {
  const [etat, setEtat] = useState<Etat | null>(null);
  const [urls, setUrls] = useState<Urls | null>(null);
  const [connexion, setConnexion] = useState<"attente" | "direct" | "perdue">("attente");
  const [erreur, setErreur] = useState<string | null>(null);
  const [outil, setOutil] = useState<Outil>("main");
  const [selection, setSelection] = useState<string | null>(null);
  const [vueJoueur, setVueJoueur] = useState(false);
  const [onglet, setOnglet] = useState<"pions" | "des" | "ambiance" | "carte">("pions");
  const [sonActif, setSonActif] = useState(false);
  const [volume, setVolume] = useState(0.5);
  const [quantite, setQuantite] = useState(1);
  const moteurSon = useRef<AmbianceSonore | null>(null);
  const [vue, setVue] = useState({ x: 40, y: 40, z: 0.8 });
  const [pings, setPings] = useState<Ping[]>([]);
  const [toast, setToast] = useState<Jet | null>(null);
  // Geste en cours (local, avant envoi)
  const [glisse, setGlisse] = useState<{ id: string; px: number; py: number } | null>(null);
  const [regle, setRegle] = useState<{ a: [number, number]; b: [number, number] } | null>(null);
  const [zone, setZone] = useState<{ a: [number, number]; b: [number, number] } | null>(null);
  // Dés
  const [expr, setExpr] = useState("1d20");
  const [raison, setRaison] = useState("");
  const [secret, setSecret] = useState(false);

  const cadre = useRef<HTMLDivElement>(null);
  const geste = useRef<{ type: "pan" | "pion" | "regle" | "zone"; sx: number; sy: number; ox: number; oy: number; id?: string } | null>(null);
  const pointeurs = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; z: number } | null>(null);
  const filVu = useRef<string | null>(null);
  const filCharge = useRef(false);
  const pingId = useRef(0);

  // ─────────────── Connexion temps réel ───────────────
  // Le ticket vit en mémoire côté bot : après un redémarrage de La Fripouille il n'est
  // plus valable, EventSource abandonne (CLOSED) → on redemande un ticket et on rebranche.
  const reconnecter = useRef<() => void>(() => undefined);
  useEffect(() => {
    let es: EventSource | null = null;
    let vivant = true;
    let relance: ReturnType<typeof setTimeout> | null = null;
    const plusTard = (ms: number) => {
      if (relance) clearTimeout(relance);
      if (vivant) relance = setTimeout(connecter, ms);
    };
    const connecter = async () => {
      es?.close();
      try {
        const r = await fetch("/api/table/plateau", { method: "POST" });
        if (!r.ok) throw new Error();
        const u: Urls = await r.json();
        if (!vivant) return;
        setUrls(u);
        es = new EventSource(u.flux_url);
        es.onopen = () => {
          setConnexion("direct");
          setErreur(null);
        };
        es.onerror = () => {
          setConnexion("perdue");
          if (es?.readyState === EventSource.CLOSED) plusTard(3000);
        };
        es.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.type === "etat") setEtat(m.etat);
          else if (m.type === "ping") {
            const p = { id: ++pingId.current, x: m.x, y: m.y, qui: m.qui, couleur: m.couleur };
            setPings((ps) => [...ps, p]);
            setTimeout(() => setPings((ps) => ps.filter((q) => q.id !== p.id)), 2600);
          }
        };
      } catch {
        setConnexion("perdue");
        setErreur("Impossible de rejoindre la table pour l'instant — nouvel essai dans quelques secondes…");
        plusTard(5000);
      }
    };
    reconnecter.current = () => plusTard(0);
    connecter();
    return () => {
      vivant = false;
      if (relance) clearTimeout(relance);
      es?.close();
    };
  }, []);

  const sonScene = etat?.ambiance?.son ?? "aucun";
  useEffect(() => {
    if (!sonActif) {
      moteurSon.current?.arreter();
      return;
    }
    if (!moteurSon.current) moteurSon.current = new AmbianceSonore();
    moteurSon.current.volume(volume);
    moteurSon.current.jouer(sonScene);
  }, [sonActif, sonScene, volume]);
  useEffect(() => () => moteurSon.current?.fermer(), []);

  // Nouveau jet dans le fil → bandeau visible de toute la table quelques secondes.
  useEffect(() => {
    if (!etat) return;
    const dernier = etat.fil[etat.fil.length - 1];
    if (!filCharge.current) {
      // premier état reçu : l'historique n'a pas droit au bandeau
      filCharge.current = true;
      filVu.current = dernier?.id ?? null;
      return;
    }
    if (!dernier || dernier.id === filVu.current) return;
    filVu.current = dernier.id;
    setToast(dernier);
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [etat]);

  const op = useCallback(
    async (corps: Record<string, unknown>) => {
      if (!urls) return null;
      try {
        const r = await fetch(urls.op_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corps),
        });
        const d = await r.json().catch(() => ({}));
        if (r.status === 401) {
          reconnecter.current();
          setErreur("La table se reconnecte — refais ton geste dans un instant.");
          return null;
        }
        if (!r.ok) setErreur(d.error || "Geste refusé.");
        else setErreur(null);
        return r.ok ? d : null;
      } catch {
        setErreur("Connexion perdue avec la table.");
        return null;
      }
    },
    [urls]
  );

  // ─────────────── Coordonnées ───────────────
  const versMonde = useCallback(
    (cx: number, cy: number) => {
      const r = cadre.current!.getBoundingClientRect();
      return { x: (cx - r.left - vue.x) / vue.z, y: (cy - r.top - vue.y) / vue.z };
    },
    [vue]
  );
  const versCase = (wx: number, wy: number): [number, number] => [Math.floor(wx / CASE), Math.floor(wy / CASE)];

  const c = etat?.carte;
  const borne = useCallback(
    (x: number, y: number, t = 1): [number, number] =>
      c ? [Math.max(0, Math.min(c.cols - t, x)), Math.max(0, Math.min(c.rows - t, y))] : [x, y],
    [c]
  );

  const revele = useCallback(
    (x: number, y: number) =>
      !etat?.brouillard.actif ||
      etat.brouillard.reveles.some(([rx, ry, rl, rh]) => x >= rx && y >= ry && x < rx + rl && y < ry + rh),
    [etat]
  );

  // Centrer la carte au premier chargement.
  const centree = useRef(false);
  useEffect(() => {
    if (!c || centree.current || !cadre.current) return;
    centree.current = true;
    const r = cadre.current.getBoundingClientRect();
    const z = Math.min(1.2, Math.max(0.3, Math.min((r.width - 40) / (c.cols * CASE), (r.height - 40) / (c.rows * CASE))));
    setVue({ z, x: (r.width - c.cols * CASE * z) / 2, y: (r.height - c.rows * CASE * z) / 2 });
  }, [c]);

  // ─────────────── Gestes à la souris / au doigt ───────────────
  const surDown = (e: React.PointerEvent) => {
    if (!etat) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointeurs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointeurs.current.size === 2) {
      const [a, b] = [...pointeurs.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), z: vue.z };
      geste.current = null;
      setGlisse(null);
      return;
    }
    const w = versMonde(e.clientX, e.clientY);
    const cible = (e.target as HTMLElement).closest("[data-pion]") as HTMLElement | null;
    if (outil === "main" && cible && e.button === 0) {
      const p = etat.pions.find((x) => x.id === cible.dataset.pion)!;
      setSelection(p.id);
      geste.current = { type: "pion", sx: w.x, sy: w.y, ox: p.x * CASE, oy: p.y * CASE, id: p.id };
      setGlisse({ id: p.id, px: p.x * CASE, py: p.y * CASE });
    } else if (outil === "regle") {
      const k = versCase(w.x, w.y);
      geste.current = { type: "regle", sx: w.x, sy: w.y, ox: 0, oy: 0 };
      setRegle({ a: k, b: k });
    } else if (outil === "reveler" || outil === "masquer") {
      const k = versCase(w.x, w.y);
      geste.current = { type: "zone", sx: w.x, sy: w.y, ox: 0, oy: 0 };
      setZone({ a: k, b: k });
    } else if (outil === "ping") {
      op({ op: "ping", x: w.x / CASE, y: w.y / CASE });
    } else {
      if (!cible) setSelection(null);
      geste.current = { type: "pan", sx: e.clientX, sy: e.clientY, ox: vue.x, oy: vue.y };
    }
  };

  const surMove = (e: React.PointerEvent) => {
    if (!pointeurs.current.has(e.pointerId)) return;
    pointeurs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointeurs.current.size === 2) {
      const [a, b] = [...pointeurs.current.values()];
      const z = Math.max(0.25, Math.min(3, (pinch.current.z * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.d));
      setVue((v) => ({ ...v, z }));
      return;
    }
    const g = geste.current;
    if (!g) return;
    if (g.type === "pan") {
      setVue((v) => ({ ...v, x: g.ox + e.clientX - g.sx, y: g.oy + e.clientY - g.sy }));
      return;
    }
    const w = versMonde(e.clientX, e.clientY);
    if (g.type === "pion") setGlisse({ id: g.id!, px: g.ox + w.x - g.sx, py: g.oy + w.y - g.sy });
    else if (g.type === "regle") setRegle((r) => (r ? { ...r, b: versCase(w.x, w.y) } : r));
    else if (g.type === "zone") setZone((z) => (z ? { ...z, b: versCase(w.x, w.y) } : z));
  };

  const surUp = (e: React.PointerEvent) => {
    pointeurs.current.delete(e.pointerId);
    if (pointeurs.current.size < 2) pinch.current = null;
    const g = geste.current;
    geste.current = null;
    if (!g || !etat) return;
    if (g.type === "pion" && glisse) {
      const p = etat.pions.find((x) => x.id === g.id);
      setGlisse(null);
      if (!p) return;
      const [x, y] = borne(Math.round(glisse.px / CASE), Math.round(glisse.py / CASE), p.taille);
      if (x === p.x && y === p.y) return;
      // Optimiste : le pion se pose tout de suite, le flux confirme ensuite.
      setEtat((s) => s && { ...s, pions: s.pions.map((q) => (q.id === p.id ? { ...q, x, y } : q)) });
      op({ op: "pion_deplacer", id: p.id, x, y });
    } else if (g.type === "zone" && zone) {
      const x = Math.min(zone.a[0], zone.b[0]), y = Math.min(zone.a[1], zone.b[1]);
      const l = Math.abs(zone.a[0] - zone.b[0]) + 1, h = Math.abs(zone.a[1] - zone.b[1]) + 1;
      op({ op: outil === "masquer" ? "masquer" : "reveler", zone: [x, y, l, h] });
      setZone(null);
    }
  };

  const surRoue = (e: React.WheelEvent) => {
    const r = cadre.current!.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    setVue((v) => {
      const z = Math.max(0.25, Math.min(3, v.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      return { z, x: mx - ((mx - v.x) * z) / v.z, y: my - ((my - v.y) * z) / v.z };
    });
  };

  // Raccourcis : 1-5 outils, Suppr = retirer le pion sélectionné, Échap = désélection.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = (e.target as HTMLElement)?.tagName;
      if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return;
      const i = Number(e.key) - 1;
      if (i >= 0 && i < OUTILS.length) setOutil(OUTILS[i].id);
      else if (e.key === "Escape") { setSelection(null); setRegle(null); }
      else if ((e.key === "Delete" || e.key === "Backspace") && selection) {
        op({ op: "pion_supprimer", id: selection });
        setSelection(null);
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [selection, op]);

  // ─────────────── Actions du panneau ───────────────
  const centreVue = (): [number, number] => {
    if (!cadre.current || !c) return [0, 0];
    const r = cadre.current.getBoundingClientRect();
    const w = { x: (r.width / 2 - vue.x) / vue.z, y: (r.height / 2 - vue.y) / vue.z };
    return borne(Math.floor(w.x / CASE), Math.floor(w.y / CASE));
  };
  /** Case libre la plus proche (spirale) : deux pions ajoutés ne s'empilent pas. */
  const caseLibre = (x0: number, y0: number, taille = 1, pris: [number, number, number][] = []): [number, number] => {
    const tous = [...(etat?.pions.map((p) => [p.x, p.y, p.taille] as [number, number, number]) || []), ...pris];
    const libre = (x: number, y: number) =>
      !tous.some(([px, py, pt]) => x < px + pt && px < x + taille && y < py + pt && py < y + taille);
    for (let r = 0; r < 40; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const [x, y] = borne(x0 + dx, y0 + dy, taille);
          if (libre(x, y)) return [x, y];
        }
    return [x0, y0];
  };
  const ajouterHeros = async (cl: Classe) => {
    const n = etat?.pions.filter((p) => p.type === "joueur").length || 0;
    const entree = SCENES.find((x) => x.id === etat?.scene?.id)?.entree;
    const [x, y] = caseLibre(...(entree ?? centreVue()));
    const d = await op({
      op: "pion_ajouter", nom: cl.nom, type: "joueur", icone: cl.icone,
      couleur: COULEURS_HEROS[n % COULEURS_HEROS.length], x, y, pv_max: null,
    });
    if (d?.id) setSelection(d.id);
  };
  const ajouterCreatures = async (cr: Creature) => {
    const deja = etat?.pions.filter((p) => p.nom.startsWith(cr.nom)).length || 0;
    const [cx, cy] = centreVue();
    const pris: [number, number, number][] = [];
    let dernier: string | null = null;
    for (let k = 1; k <= quantite; k++) {
      const [x, y] = caseLibre(cx, cy, cr.taille, pris);
      pris.push([x, y, cr.taille]);
      const nom = quantite === 1 && deja === 0 ? cr.nom : `${cr.nom} ${deja + k}`;
      const d = await op({
        op: "pion_ajouter", nom, type: "monstre", icone: cr.icone, couleur: cr.couleur,
        taille: cr.taille, pv_max: cr.pv, x, y,
      });
      if (d?.id) dernier = d.id;
    }
    if (dernier) setSelection(dernier);
  };
  const ajouterPion = async (type: TypePion) => {
    const n = (etat?.pions.filter((p) => p.type === type).length || 0) + 1;
    const nom = type === "joueur" ? `Héros ${n}` : type === "monstre" ? `Monstre ${n}` : `PNJ ${n}`;
    const [x, y] = caseLibre(...centreVue());
    const d = await op({ op: "pion_ajouter", nom, type, couleur: COULEURS[type], x, y, pv_max: type === "joueur" ? null : 10 });
    if (d?.id) setSelection(d.id);
  };
  const chargerScene = (sc: Scene) => {
    if (etat?.pions.length && !window.confirm(`Passer à « ${sc.nom} » ? Les pions restent, le brouillard repart de zéro.`)) return;
    centree.current = false; // recadrer sur la nouvelle carte
    op({
      op: "scene", id: sc.id, nom: sc.nom, image_url: sc.image_url, cols: sc.cols, rows: sc.rows,
      lumieres: sc.lumieres, ambiance: sc.ambiance, brouillard: !!sc.brouillard, quadrillage: true,
    });
  };
  const ambiance = (champ: "lumiere" | "meteo" | "son", v: string) => op({ op: "ambiance", [champ]: v });
  const majPion = (id: string, champs: Partial<Pion>) => {
    setEtat((s) => s && { ...s, pions: s.pions.map((p) => (p.id === id ? { ...p, ...champs } : p)) });
    op({ op: "pion_maj", id, ...champs });
  };
  const lancer = async (e?: string) => {
    const d = await op({ op: "jet", expr: (e ?? expr).replace(/\s/g, "") || "1d20", raison, secret });
    if (d) setRaison("");
  };

  const sel = etat?.pions.find((p) => p.id === selection) || null;
  const distance = useMemo(() => {
    if (!regle) return null;
    const cases = Math.max(Math.abs(regle.a[0] - regle.b[0]), Math.abs(regle.a[1] - regle.b[1]));
    return { cases, m: (cases * METRES_PAR_CASE).toLocaleString("fr-FR") };
  }, [regle]);

  if (erreur && !etat) return <div className="piste-chargement">{erreur}</div>;
  if (!etat || !c) return <div className="piste-chargement">On déroule la carte…</div>;

  const L = c.cols * CASE, H = c.rows * CASE;
  const masque = etat.brouillard.actif;
  const amb = etat.ambiance ?? { lumiere: "jour", meteo: "aucune", son: "aucun" as Son };
  const sceneCourante = SCENES.find((x) => x.id === etat.scene?.id);
  const accueil = !etat.scene?.id && !c.image_url && etat.pions.length === 0;
  // Sources de lumière la nuit : celles du décor + une torche par héros.
  const sources = [
    ...(etat.scene?.lumieres || []).map(([x, y, r]) => ({ x, y, r })),
    ...etat.pions.filter((p) => p.type === "joueur").map((p) => {
      const g = glisse?.id === p.id ? glisse : null;
      return { x: (g ? g.px / CASE : p.x) + p.taille / 2, y: (g ? g.py / CASE : p.y) + p.taille / 2, r: TORCHE };
    }),
  ];
  const bestiaire = [
    ...BESTIAIRE.filter((b) => sceneCourante?.bestiaire.includes(b.id)),
    ...BESTIAIRE.filter((b) => !sceneCourante?.bestiaire.includes(b.id)),
  ];

  return (
    <div className="plateau">
      <header className="piste-tete">
        <a href="/?s=des" className="piste-retour">← Panneau</a>
        <h1>Plateau de jeu</h1>
        <a href="/table" className="piste-retour">🎲 Piste de dés</a>
        {etat.scene?.nom && <span className="plateau-scene-nom">— {etat.scene.nom}</span>}
        <div className="plateau-son">
          <button
            className={sonActif ? "on" : ""}
            onClick={() => setSonActif((v) => !v)}
            title={amb.son === "aucun" ? "Le MJ n'a pas choisi d'ambiance sonore" : "Ambiance sonore (chez toi seulement)"}
          >
            {sonActif ? "🔊" : "🔇"} Ambiance
          </button>
          {sonActif && (
            <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Volume" />
          )}
        </div>
        <span className={`plateau-direct ${connexion}`}>
          {connexion === "direct" ? "● En direct" : connexion === "perdue" ? "● Reconnexion…" : "● Connexion…"}
        </span>
      </header>

      <div className="plateau-corps">
        <div className="plateau-zone">
          <div className="plateau-outils">
            {OUTILS.map((o, i) => (
              <button
                key={o.id}
                className={outil === o.id ? "on" : ""}
                onClick={() => setOutil(o.id)}
                title={`${o.aide} (touche ${i + 1})`}
              >
                <span>{o.icone}</span>
                {o.label}
              </button>
            ))}
            <label className="plateau-vuejoueur" title="Voir la carte comme un joueur (brouillard opaque, pions cachés invisibles)">
              <input type="checkbox" checked={vueJoueur} onChange={(e) => setVueJoueur(e.target.checked)} />
              Vue joueur
            </label>
          </div>

          <div
            ref={cadre}
            className={`plateau-vue outil-${outil}`}
            onPointerDown={surDown}
            onPointerMove={surMove}
            onPointerUp={surUp}
            onPointerCancel={surUp}
            onWheel={surRoue}
            onDoubleClick={(e) => {
              const w = versMonde(e.clientX, e.clientY);
              op({ op: "ping", x: w.x / CASE, y: w.y / CASE });
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div
              className={`plateau-monde ${vue.z < 0.75 ? "zoom-petit" : ""}`}
              style={{ width: L, height: H, transform: `translate(${vue.x}px, ${vue.y}px) scale(${vue.z})` }}
            >
              {c.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="plateau-fond" src={c.image_url} alt="" draggable={false} />
              ) : (
                <div className="plateau-fond plateau-fond-defaut" />
              )}

              {c.quadrillage && (
                <svg className="plateau-grille" width={L} height={H}>
                  <defs>
                    <pattern id="grille" width={CASE} height={CASE} patternUnits="userSpaceOnUse">
                      <path d={`M ${CASE} 0 L 0 0 0 ${CASE}`} fill="none" stroke="rgba(255,240,210,0.18)" strokeWidth="1.5" />
                    </pattern>
                  </defs>
                  <rect width={L} height={H} fill="url(#grille)" />
                </svg>
              )}

              {etat.pions.map((p) => {
                const cachee = (p.cache || (p.type !== "joueur" && !revele(p.x, p.y))) && vueJoueur;
                if (cachee) return null;
                const g = glisse?.id === p.id ? glisse : null;
                const t = p.taille * CASE;
                const pvRatio = p.pv_max ? Math.max(0, Math.min(1, (p.pv ?? 0) / p.pv_max)) : null;
                return (
                  <div
                    key={p.id}
                    data-pion={p.id}
                    className={`pion type-${p.type} ${selection === p.id ? "sel" : ""} ${p.cache ? "cache" : ""} ${g ? "glisse" : ""} ${p.pv !== null && p.pv <= 0 ? "ko" : ""}`}
                    style={{ width: t, height: t, transform: `translate(${g ? g.px : p.x * CASE}px, ${g ? g.py : p.y * CASE}px)`, ["--teinte" as string]: p.couleur }}
                    title={p.nom}
                  >
                    <div className="pion-disque">
                      {p.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.image_url} alt="" draggable={false} />
                      ) : p.icone ? (
                        <span className="pion-icone">{p.icone}</span>
                      ) : (
                        <span>{initiales(p.nom)}</span>
                      )}
                    </div>
                    {pvRatio !== null && (
                      <div className="pion-pv">
                        <i style={{ width: `${pvRatio * 100}%`, background: pvRatio > 0.5 ? "#7fbf5a" : pvRatio > 0.25 ? "#e0a33a" : "#d0452c" }} />
                      </div>
                    )}
                    <div className="pion-nom">{p.nom}</div>
                    {p.etats.length > 0 && <div className="pion-etats">{p.etats.map((s) => s[0]).join("")}</div>}
                  </div>
                );
              })}

              {amb.lumiere !== "jour" && (
                <svg className="plateau-nuit" width={L} height={H}>
                  <defs>
                    <radialGradient id="halo">
                      <stop offset="0%" stopColor="black" />
                      <stop offset="45%" stopColor="black" stopOpacity="0.92" />
                      <stop offset="100%" stopColor="black" stopOpacity="0" />
                    </radialGradient>
                    <mask id="obscurite">
                      <rect width={L} height={H} fill="white" />
                      {sources.map((l, i) => (
                        <circle key={i} cx={l.x * CASE} cy={l.y * CASE} r={l.r * CASE} fill="url(#halo)" />
                      ))}
                    </mask>
                  </defs>
                  <rect
                    width={L}
                    height={H}
                    fill={amb.lumiere === "nuit" ? "#04060e" : "#2b1236"}
                    opacity={amb.lumiere === "nuit" ? (vueJoueur ? 0.88 : 0.62) : 0.36}
                    mask="url(#obscurite)"
                  />
                </svg>
              )}

              {masque && (
                <svg className="plateau-brume" width={L} height={H}>
                  <defs>
                    <mask id="trous">
                      <rect width={L} height={H} fill="white" />
                      {etat.brouillard.reveles.map(([x, y, l, h], i) => (
                        <rect key={i} x={x * CASE} y={y * CASE} width={l * CASE} height={h * CASE} fill="black" />
                      ))}
                    </mask>
                  </defs>
                  <rect width={L} height={H} fill="#0b0703" opacity={vueJoueur ? 1 : 0.55} mask="url(#trous)" />
                </svg>
              )}

              {zone && (
                <div
                  className={`plateau-selzone ${outil}`}
                  style={{
                    left: Math.min(zone.a[0], zone.b[0]) * CASE,
                    top: Math.min(zone.a[1], zone.b[1]) * CASE,
                    width: (Math.abs(zone.a[0] - zone.b[0]) + 1) * CASE,
                    height: (Math.abs(zone.a[1] - zone.b[1]) + 1) * CASE,
                  }}
                />
              )}

              {regle && distance && (
                <svg className="plateau-regle" width={L} height={H}>
                  <line
                    x1={(regle.a[0] + 0.5) * CASE} y1={(regle.a[1] + 0.5) * CASE}
                    x2={(regle.b[0] + 0.5) * CASE} y2={(regle.b[1] + 0.5) * CASE}
                  />
                  <circle cx={(regle.a[0] + 0.5) * CASE} cy={(regle.a[1] + 0.5) * CASE} r="7" />
                  <circle cx={(regle.b[0] + 0.5) * CASE} cy={(regle.b[1] + 0.5) * CASE} r="7" />
                  <text x={(regle.b[0] + 0.5) * CASE + 14} y={(regle.b[1] + 0.5) * CASE - 14}>
                    {distance.cases} case{distance.cases > 1 ? "s" : ""} · {distance.m} m
                  </text>
                </svg>
              )}

              {pings.map((p) => (
                <div key={p.id} className="plateau-ping" style={{ left: p.x * CASE, top: p.y * CASE, ["--teinte" as string]: p.couleur }}>
                  <span>{p.qui}</span>
                </div>
              ))}
            </div>

            {amb.meteo !== "aucune" && (
              <div
                className={`plateau-meteo meteo-${amb.meteo}`}
                style={TUILES[amb.meteo] ? { ["--tuile" as string]: TUILES[amb.meteo] } : undefined}
                aria-hidden
              />
            )}

            {accueil && (
              <div className="plateau-accueil" onPointerDown={(e) => e.stopPropagation()}>
                <h2>Quelle aventure ce soir ?</h2>
                <p>Choisis un décor : la carte, la lumière, la météo et l&apos;ambiance sonore sont prêtes.</p>
                <div className="plateau-scenes">
                  {SCENES.map((sc) => (
                    <button key={sc.id} className="scene-carte" onClick={() => chargerScene(sc)}>
                      <span className={`scene-vignette ${sc.image_url ? "" : "vierge"}`} style={sc.image_url ? { backgroundImage: `url(${sc.image_url})` } : undefined} />
                      <b>{sc.nom}</b>
                      <span>{sc.accroche}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {toast && (
              <div className={`plateau-toast ${toast.nat === 20 ? "crit" : toast.nat === 1 ? "fumble" : ""}`}>
                <b>{toast.qui}</b>
                {toast.raison ? ` · ${toast.raison}` : ""} — <code>{toast.expr}</code> →{" "}
                <strong>{toast.cache && vueJoueur ? "?" : toast.total}</strong>
                {toast.nat === 20 && " ✨"}
                {toast.nat === 1 && " 💀"}
              </div>
            )}
            <div className="plateau-zoom">
              <button onClick={() => setVue((v) => ({ ...v, z: Math.min(3, v.z * 1.2) }))}>+</button>
              <span>{Math.round(vue.z * 100)} %</span>
              <button onClick={() => setVue((v) => ({ ...v, z: Math.max(0.25, v.z / 1.2) }))}>−</button>
            </div>
          </div>
          <p className="plateau-aide">{OUTILS.find((o) => o.id === outil)?.aide}</p>
          {erreur && <p className="piste-erreur">{erreur}</p>}
        </div>

        <aside className="plateau-panneau">
          <div className="plateau-onglets">
            {(["pions", "des", "ambiance", "carte"] as const).map((o) => (
              <button key={o} className={onglet === o ? "on" : ""} onClick={() => setOnglet(o)}>
                {o === "pions" ? "Pions" : o === "des" ? "Dés" : o === "ambiance" ? "Ambiance" : "Scène"}
              </button>
            ))}
          </div>

          {onglet === "pions" && (
            <div className="plateau-section">
              <details className="plateau-tiroir" open={etat.pions.length === 0}>
                <summary>🛡️ Ajouter un héros</summary>
                <div className="plateau-classes">
                  {CLASSES.map((cl) => (
                    <button key={cl.nom} onClick={() => ajouterHeros(cl)} title={`Ajouter un ${cl.nom.toLowerCase()}`}>
                      <span>{cl.icone}</span>
                      {cl.nom}
                    </button>
                  ))}
                </div>
              </details>
              <details className="plateau-tiroir">
                <summary>🐉 Bestiaire {sceneCourante?.bestiaire.length ? <em>· suggestions de la scène en tête</em> : null}</summary>
                <div className="plateau-quantite">
                  Combien ?
                  {[1, 2, 3, 4, 6].map((n) => (
                    <button key={n} className={quantite === n ? "on" : ""} onClick={() => setQuantite(n)}>×{n}</button>
                  ))}
                </div>
                <div className="plateau-bestiaire">
                  {bestiaire.map((cr) => (
                    <button key={cr.id} onClick={() => ajouterCreatures(cr)} className={sceneCourante?.bestiaire.includes(cr.id) ? "suggere" : ""}>
                      <span className="bestiaire-icone" style={{ background: cr.couleur }}>{cr.icone}</span>
                      <span className="bestiaire-nom">{cr.nom}</span>
                      <small>{cr.pv} PV{cr.taille > 1 ? " · Grand" : ""}</small>
                    </button>
                  ))}
                </div>
                <button className="plateau-pnj" onClick={() => ajouterPion("pnj")}>+ PNJ (tavernier, marchand, garde…)</button>
              </details>

              {sel ? (
                <div className="plateau-fiche" key={sel.id}>
                  <input
                    className="plateau-fiche-nom"
                    defaultValue={sel.nom}
                    maxLength={30}
                    onBlur={(e) => e.target.value !== sel.nom && majPion(sel.id, { nom: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  />
                  <div className="plateau-fiche-ligne">
                    <select value={sel.type} onChange={(e) => majPion(sel.id, { type: e.target.value as TypePion })}>
                      <option value="joueur">Joueur</option>
                      <option value="monstre">Monstre</option>
                      <option value="pnj">PNJ</option>
                    </select>
                    <select value={sel.taille} onChange={(e) => majPion(sel.id, { taille: Number(e.target.value) })} title="Taille (cases)">
                      <option value={1}>Moyen (1×1)</option>
                      <option value={2}>Grand (2×2)</option>
                      <option value={3}>Très grand (3×3)</option>
                      <option value={4}>Gigantesque (4×4)</option>
                    </select>
                    <input type="color" value={sel.couleur} onChange={(e) => majPion(sel.id, { couleur: e.target.value })} title="Couleur" />
                  </div>

                  <div className="plateau-pv">
                    <span>PV</span>
                    {[-5, -1].map((d) => (
                      <button key={d} onClick={() => majPion(sel.id, { pv: (sel.pv ?? 0) + d })} disabled={sel.pv === null}>{d}</button>
                    ))}
                    <input
                      type="number"
                      value={sel.pv ?? ""}
                      placeholder="—"
                      onChange={(e) => majPion(sel.id, { pv: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                    <span>/</span>
                    <input
                      type="number"
                      value={sel.pv_max ?? ""}
                      placeholder="max"
                      onChange={(e) => majPion(sel.id, { pv_max: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                    {[1, 5].map((d) => (
                      <button key={d} onClick={() => majPion(sel.id, { pv: (sel.pv ?? 0) + d })} disabled={sel.pv === null}>+{d}</button>
                    ))}
                  </div>

                  <div className="plateau-etats">
                    {ETATS.map((s) => (
                      <button
                        key={s}
                        className={sel.etats.includes(s) ? "on" : ""}
                        onClick={() =>
                          majPion(sel.id, { etats: sel.etats.includes(s) ? sel.etats.filter((x) => x !== s) : [...sel.etats, s] })
                        }
                      >
                        {s}
                      </button>
                    ))}
                  </div>

                  <label className="plateau-coche">
                    <input type="checkbox" checked={sel.cache} onChange={(e) => majPion(sel.id, { cache: e.target.checked })} />
                    Caché aux joueurs (embuscade…)
                  </label>
                  <div className="plateau-image">
                    <MediaPicker value={sel.image_url} onChange={(v) => majPion(sel.id, { image_url: v })} />
                  </div>
                  <button className="plateau-suppr" onClick={() => { op({ op: "pion_supprimer", id: sel.id }); setSelection(null); }}>
                    Retirer du plateau
                  </button>
                </div>
              ) : (
                <p className="piste-vide">Clique un pion pour le modifier (PV, états, taille…).</p>
              )}

              <ul className="plateau-liste">
                {etat.pions.filter((p) => !(vueJoueur && (p.cache || (p.type !== "joueur" && !revele(p.x, p.y))))).map((p) => (
                  <li key={p.id} className={selection === p.id ? "on" : ""} onClick={() => setSelection(p.id)}>
                    <i style={{ background: p.couleur }} />
                    <span>{p.nom}</span>
                    {p.cache && <em>caché</em>}
                    {p.pv_max ? <b>{p.pv}/{p.pv_max}</b> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {onglet === "des" && (
            <div className="plateau-section">
              <div className="plateau-desrapides">
                {DES.map((f) => (
                  <button key={f} className={`piste-de de-${f}`} onClick={() => lancer(`1d${f}`)} title={`Lancer 1d${f}`}>
                    <span>d{f}</span>
                  </button>
                ))}
              </div>
              <div className="plateau-jet">
                <input value={expr} onChange={(e) => setExpr(e.target.value)} onKeyDown={(e) => e.key === "Enter" && lancer()} placeholder="1d20+5, 2d6+3…" />
                <input value={raison} onChange={(e) => setRaison(e.target.value)} onKeyDown={(e) => e.key === "Enter" && lancer()} placeholder="Pour quoi ?" maxLength={60} />
                <label className="plateau-coche">
                  <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} />
                  Jet secret (MJ)
                </label>
                <button className="piste-lancer" onClick={() => lancer()}>Lancer</button>
              </div>
              <h2>Fil de la table</h2>
              <ol className="plateau-fil">
                {[...etat.fil].reverse().map((j) => (
                  <li key={j.id} className={j.nat === 20 ? "crit" : j.nat === 1 ? "fumble" : ""}>
                    <div>
                      <b>{j.qui}</b>
                      {j.raison && <span> · {j.raison}</span>}
                      {j.cache && <em> 🔒</em>}
                      <strong>{j.cache && vueJoueur ? "?" : j.total}</strong>
                    </div>
                    {!(j.cache && vueJoueur) && (
                      <small>
                        {j.lignes.map((l, i) => (
                          <span key={i}>
                            <Ligne texte={l} />{" "}
                          </span>
                        ))}
                      </small>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {onglet === "ambiance" && (
            <div className="plateau-section">
              <h2>Lumière</h2>
              <div className="plateau-choix">
                {LUMIERES.map((l) => (
                  <button key={l.id} className={amb.lumiere === l.id ? "on" : ""} onClick={() => ambiance("lumiere", l.id)}>{l.label}</button>
                ))}
              </div>
              <p className="piste-vide">La nuit, seuls les feux du décor et la torche de chaque héros ({TORCHE} cases) éclairent la carte.</p>
              <h2>Météo</h2>
              <div className="plateau-choix">
                {METEOS.map((m) => (
                  <button key={m.id} className={amb.meteo === m.id ? "on" : ""} onClick={() => ambiance("meteo", m.id)}>{m.label}</button>
                ))}
              </div>
              <h2>Ambiance sonore</h2>
              <div className="plateau-choix">
                {SONS.map((x) => (
                  <button key={x.id} className={amb.son === x.id ? "on" : ""} onClick={() => ambiance("son", x.id)}>{x.label}</button>
                ))}
              </div>
              <p className="piste-vide">
                Le son est créé dans le navigateur de chacun : chaque joueur l&apos;allume avec 🔇 Ambiance en haut,
                et règle son propre volume.
              </p>
            </div>
          )}

          {onglet === "carte" && (
            <div className="plateau-section">
              <h2>Scènes prêtes à jouer</h2>
              <div className="plateau-scenes compact">
                {SCENES.map((sc) => (
                  <button key={sc.id} className={`scene-carte ${etat.scene?.id === sc.id ? "on" : ""}`} onClick={() => chargerScene(sc)} title={sc.accroche}>
                    <span className={`scene-vignette ${sc.image_url ? "" : "vierge"}`} style={sc.image_url ? { backgroundImage: `url(${sc.image_url})` } : undefined} />
                    <b>{sc.nom}</b>
                  </button>
                ))}
              </div>
              <h2>Ta propre carte</h2>
              <MediaPicker value={c.image_url} onChange={(v) => op({ op: "carte", image_url: v })} />
              <p className="piste-vide">Règle les cases pour qu&apos;elles tombent sur le quadrillage de l&apos;image.</p>
              <div className="plateau-fiche-ligne">
                <label>
                  Colonnes
                  <input type="number" min={4} max={80} defaultValue={c.cols} key={`c${c.cols}`} onBlur={(e) => op({ op: "carte", cols: Number(e.target.value) })} />
                </label>
                <label>
                  Lignes
                  <input type="number" min={4} max={80} defaultValue={c.rows} key={`r${c.rows}`} onBlur={(e) => op({ op: "carte", rows: Number(e.target.value) })} />
                </label>
              </div>
              <label className="plateau-coche">
                <input type="checkbox" checked={c.quadrillage} onChange={(e) => op({ op: "carte", quadrillage: e.target.checked })} />
                Afficher le quadrillage
              </label>
              <h2>Brouillard de guerre</h2>
              <label className="plateau-coche">
                <input type="checkbox" checked={etat.brouillard.actif} onChange={(e) => op({ op: "brouillard", actif: e.target.checked })} />
                Activer le brouillard
              </label>
              <p className="piste-vide">Outils 🔦 Révéler / 🌫️ Masquer sur la carte. Le MJ voit à travers (voile), les joueurs non.</p>
              <button className="plateau-suppr" onClick={() => op({ op: "brouillard_reset" })}>Tout recouvrir</button>
              <h2>Partie</h2>
              <button
                className="plateau-suppr"
                onClick={() =>
                  window.confirm("Nouvelle partie : retirer tous les pions, le brouillard et le fil des jets ? (la carte reste)") &&
                  op({ op: "reinitialiser" })
                }
              >
                🧹 Nouvelle partie
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
