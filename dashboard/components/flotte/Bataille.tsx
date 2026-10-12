"use client";

// L'écran de bataille : bandeau (manche, chrono, météo, capitaines), carte, panneau de
// flotte (ordres), journal. Les ordres partent au serveur dès qu'ils changent (le serveur
// les valide et les garde) ; « Verrouiller » dit qu'on a fini, la manche se résout dès que
// tout le monde a verrouillé ou au bout du chrono.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ALLURES, atteignables, champ as champDe, chance, cle, coutChemin, destination, distance, memeCase,
  navigable, PAVILLONS, pasMax, pointsMouvement, terrain, TERRAINS, tirPossible, voisin,
  type Action, type Cell, type Navire, type Ordre, type VueSalon,
} from "@/lib/flotte";
import Carte from "./Carte";
import { Embleme, Pavillon } from "./Emblemes";
import { texteEvt, type Annuaire } from "./journal";
import { PictoTemps, RoseDesVents } from "./Meteo";
import type { Rendu, Scene } from "./rendu";
import type { Reponse } from "./useFlotte";
import { FlotteSon, type BruitFlotte } from "@/lib/flotte-son";

export type Reglages = {
  reduit: boolean; qualite: "haute" | "basse"; son: boolean; volEffets: number; volFond: number; suivre: boolean;
};
export const REGLAGES_DEFAUT: Reglages = { reduit: false, qualite: "haute", son: false, volEffets: 0.6, volFond: 0.3, suivre: false };
const FORCE_MER: Record<string, number> = { calme: 0.1, brise: 0.4, vent_fort: 0.75, brouillard: 0.25, tempete: 1 };

// Touches physiques (event.code) des six directions, autour de S : même place sur tous les claviers.
const TOUCHES: Record<string, number> = { KeyD: 0, KeyE: 1, KeyW: 2, KeyA: 3, KeyZ: 4, KeyX: 5 };
const AZERTY = ["D", "E", "Z", "Q", "W", "X"];

export default function Bataille({ vue, op, maintenant, reglages, changerReglages, surAide, surQuitter }: {
  vue: VueSalon;
  op: (c: Record<string, unknown>) => Promise<Reponse>;
  maintenant: () => number;
  reglages: Reglages;
  changerReglages: (r: Reglages) => void;
  surAide: () => void;
  surQuitter: () => void;
}) {
  const { regles, carte, meteo } = vue;
  const rendu = useRef<Rendu | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [brouillon, setBrouillon] = useState<Record<string, Ordre>>(vue.ordres);
  const [survol, setSurvol] = useState<Cell | null>(null);
  const [refus, setRefus] = useState<string | null>(null);
  const [journal, setJournal] = useState(true);
  const [, tic] = useState(0);
  const envoi = useRef<ReturnType<typeof setTimeout> | null>(null);
  const local = useRef(false);                       // brouillon modifié, pas encore confirmé
  const manche = useRef(vue.manche);
  const anime = useRef(vue.historique.at(-1)?.manche ?? 0);
  const connus = useRef(new Map<string, Navire>());
  const annuaire = useRef<Annuaire>(new Map());
  const son = useRef<FlotteSon | null>(null);
  const [banniere, setBanniere] = useState<{ titre: string; sous: string; cle: number; breve?: boolean } | null>(null);
  const finAnim = useRef(0);

  const moi = vue.moi;
  const joueur = vue.joueurs.find((j) => j.uid === moi) ?? null;
  const enLice = !!joueur && joueur.elimine === null && !joueur.abandon;
  const planif = vue.phase === "planification" && enLice;
  const mien = useMemo(() => vue.navires.filter((n) => n.uid === moi && !n.coule), [vue.navires, moi]);
  const ennemis = useMemo(() => vue.navires.filter((n) => n.uid !== moi && !n.coule), [vue.navires, moi]);
  const pavillons = useMemo(() => Object.fromEntries(vue.joueurs.map((j) => [j.uid, j.pavillon])), [vue.joueurs]);
  const actifs = vue.joueurs.filter((j) => j.elimine === null && !j.abandon).length;

  // Annuaire des navires (journal), jamais oublié pendant la partie.
  for (const n of vue.navires) annuaire.current.set(n.id, { nom: n.nom, classe: n.classe, uid: n.uid });
  for (const f of vue.fantomes) annuaire.current.set(f.id, { nom: f.nom, classe: f.classe, uid: f.uid });
  for (const h of vue.historique) for (const e of h.evts) if (e.t === "coule") annuaire.current.set(e.id, { nom: e.nom, classe: e.classe, uid: e.uid });

  // Nouvelle manche : on repart des ordres du serveur (vides) ; sinon on suit le serveur
  // tant qu'aucune modification locale n'est en vol.
  useEffect(() => {
    if (vue.manche !== manche.current) {
      manche.current = vue.manche;
      local.current = false;
      setBrouillon(vue.ordres);
      return;
    }
    if (!local.current) setBrouillon(vue.ordres);
  }, [vue.manche, vue.ordres]);

  // ── son ──
  const bruit = useCallback((b: BruitFlotte, delai = 0) => {
    if (!reglages.son) return;
    son.current ??= new FlotteSon();
    son.current.jouer(b, delai);
  }, [reglages.son]);
  useEffect(() => {
    if (!reglages.son) { son.current?.ambiance(false); return; }
    son.current ??= new FlotteSon();
    son.current.volumes(reglages.volEffets, reglages.volFond);
    son.current.ambiance(true, FORCE_MER[meteo?.temps ?? "brise"]);
  }, [reglages.son, reglages.volEffets, reglages.volFond, meteo?.temps]);
  useEffect(() => () => son.current?.fermer(), []);

  // Rejouer la manche qui vient d'être résolue (sons calés sur l'animation).
  useEffect(() => {
    const der = vue.historique.at(-1);
    if (der && der.manche > anime.current) {
      anime.current = der.manche;
      const a = rendu.current?.jouer(der, connus.current);
      if (a) {
        finAnim.current = a.duree;
        for (const e of a.effets) {
          if (e.type === "tir") {
            if (e.de) bruit("canon", e.t);
            if (e.touche) bruit("impact", e.t + a.vol);
            else if (e.touche === false) bruit("gerbe", e.t + a.vol);
          } else if (e.type === "choc") bruit("choc", e.t);
          else if (e.type === "coule") bruit("naufrage", e.t);
        }
        if (reglages.suivre) rendu.current?.cadrerSur(a.cases);
      }
    }
    connus.current = new Map(vue.navires.map((n) => [n.id, n]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vue.historique, vue.navires]);

  // Bannières de phase, cloche de quart, fanfare de fin.
  const phasePrec = useRef(vue.phase);
  useEffect(() => {
    const avant = phasePrec.current;
    phasePrec.current = vue.phase;
    if (avant === vue.phase) return;
    const montrer = (titre: string, sous: string, breve = false) => setBanniere({ titre, sous, cle: Date.now(), breve });
    if (vue.phase === "preparation") montrer("Les flottes se déploient", "Repère tes navires et le vent");
    else if (vue.phase === "resolution") montrer("Feu à volonté !", `La manche ${vue.manche - 1} se joue`, true);
    else if (vue.phase === "planification") {
      montrer(`Manche ${vue.manche}`, enLice ? "À vos ordres, capitaine" : "Les capitaines délibèrent");
      bruit("cloche");
    } else if (vue.phase === "fin" && moi && vue.fin) {
      bruit(vue.fin.gagnants.includes(moi) ? "victoire" : "defaite", finAnim.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vue.phase, vue.manche]);
  useEffect(() => {
    if (!banniere) return;
    const t = setTimeout(() => setBanniere(null), reglages.reduit ? 1400 : banniere.breve ? 1500 : 2200);
    return () => clearTimeout(t);
  }, [banniere, reglages.reduit]);
  const verrouPrec = useRef(false);
  useEffect(() => {
    if (joueur?.verrou && !verrouPrec.current) bruit("verrou");
    verrouPrec.current = !!joueur?.verrou;
  }, [joueur?.verrou, bruit]);

  // Sablier : rafraîchit le chrono, et fait tiquer les 5 dernières secondes si l'on n'a pas fini.
  const dernierTic = useRef(0);
  useEffect(() => {
    const t = setInterval(() => {
      tic((x) => x + 1);
      if (vue.phase !== "planification" || !enLice || joueur?.verrou || !vue.echeance) return;
      const r = Math.ceil(vue.echeance - maintenant());
      if (r > 0 && r <= 5 && r !== dernierTic.current) { dernierTic.current = r; bruit("tic"); }
    }, 250);
    return () => clearInterval(t);
  }, [vue.phase, vue.echeance, enLice, joueur?.verrou, maintenant, bruit]);

  useEffect(() => {
    if (!refus) return;
    const t = setTimeout(() => setRefus(null), 4000);
    return () => clearTimeout(t);
  }, [refus]);

  useEffect(() => {
    if (selection && !mien.some((n) => n.id === selection)) setSelection(null);
  }, [mien, selection]);

  // ── ordres ──
  const pousser = useCallback((ordres: Record<string, Ordre>) => {
    local.current = true;
    setBrouillon(ordres);
    if (envoi.current) clearTimeout(envoi.current);
    envoi.current = setTimeout(async () => {
      const r = await op({ op: "ordres", salon: vue.id, manche: manche.current, ordres, verrou: false });
      local.current = false;
      if (!r.ok) {
        setRefus(r.erreur || "Ordre refusé.");
        setBrouillon(vue.ordres);
      }
    }, 220);
  }, [op, vue.id, vue.ordres]);

  const ordreDe = (id: string): Ordre => brouillon[id] ?? { chemin: [], action: { type: "garde" } };
  const changer = (id: string, o: Partial<Ordre>) => pousser({ ...brouillon, [id]: { ...ordreDe(id), ...o } });

  const verrouiller = useCallback(async () => {
    if (!planif) return;
    if (envoi.current) { clearTimeout(envoi.current); envoi.current = null; }
    const r = await op({ op: "ordres", salon: vue.id, manche: vue.manche, ordres: brouillon, verrou: !joueur?.verrou });
    local.current = false;
    if (!r.ok) setRefus(r.erreur || "Refusé.");
  }, [planif, op, vue.id, vue.manche, brouillon, joueur?.verrou]);

  const sel = mien.find((n) => n.id === selection) ?? null;
  const accessibles = useMemo(
    () => (planif && sel && meteo ? atteignables(regles, carte!, meteo, sel.classe, sel.pos) : null),
    [planif, sel, meteo, regles, carte],
  );
  /** Où sera le reste de ma flotte à la fin des déplacements : y aller, c'est s'éperonner. */
  const occupees = useCallback((sauf: string | null) => {
    const m = new Map<string, Navire>();
    for (const n of mien) if (n.id !== sauf) m.set(cle(destination(n, brouillon[n.id])), n);
    return m;
  }, [mien, brouillon]);
  const risques = useMemo(() => new Set(planif && sel ? occupees(sel.id).keys() : []), [planif, sel, occupees]);

  /** Cibles possibles d'un de mes navires, estimées depuis sa destination prévue. */
  const ciblesPour = useCallback((n: Navire) => {
    const o = brouillon[n.id];
    const dest = destination(n, o);
    const bouge = !!o?.chemin.length;
    return ennemis
      .map((e) => {
        const [ok, raison] = tirPossible(regles, carte!, n.classe, dest, e.pos);
        return { e, ok, raison, dist: distance(dest, e.pos), p: chance(regles, meteo!, n.classe, e.classe, distance(dest, e.pos), false, bouge) };
      })
      .sort((a, b) => Number(b.ok) - Number(a.ok) || b.p - a.p);
  }, [brouillon, ennemis, regles, carte, meteo]);

  const surCase = useCallback((c: Cell) => {
    const ici = vue.navires.find((n) => !n.coule && memeCase(n.pos, c));
    if (ici && ici.uid === moi) { setSelection(ici.id === selection ? null : ici.id); return; }
    if (!planif || !sel) { setSelection(null); return; }
    if (ici) {
      const deja = ordreDe(sel.id).action;
      changer(sel.id, { action: deja.type === "tir" && deja.cible === ici.id ? { type: "garde" } : { type: "tir", cible: ici.id } });
      return;
    }
    if (memeCase(c, sel.pos)) { changer(sel.id, { chemin: [] }); return; }
    const chemin = accessibles?.get(cle(c));
    if (chemin) changer(sel.id, { chemin });
    else setSelection(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vue.navires, moi, selection, planif, sel, accessibles, brouillon]);

  // ── clavier ──
  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      const cible = e.target as HTMLElement;
      if (cible.closest("input, textarea, select, [contenteditable]")) return;
      if (/^Digit[1-9]$/.test(e.code)) {
        const n = mien[Number(e.code.slice(5)) - 1];
        if (n) { setSelection(n.id); e.preventDefault(); }
        return;
      }
      if (e.key === "Escape") { setSelection(null); return; }
      if (e.key === "Enter" && planif && !cible.closest("button")) { verrouiller(); e.preventDefault(); return; }
      if (e.key === "+" || e.key === "=") { rendu.current?.zoomer(1.2); return; }
      if (e.key === "-") { rendu.current?.zoomer(1 / 1.2); return; }
      if (e.code === "KeyC" && mien[0]) { rendu.current?.centrerSur((sel ?? mien[0]).pos); return; }
      if (e.key.startsWith("Arrow")) {
        const d = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[e.key];
        if (d) { rendu.current?.deplacer(d[0], d[1]); e.preventDefault(); }
        return;
      }
      if (!planif || !sel || !meteo) return;
      const o = ordreDe(sel.id);
      if (e.code === "KeyG") { changer(sel.id, { action: { type: "garde" } }); return; }
      if (e.code === "KeyT") {
        const l = ciblesPour(sel).filter((x) => x.ok);
        if (!l.length) return;
        const i = o.action.type === "tir" ? l.findIndex((x) => x.e.id === (o.action as { cible: string }).cible) : -1;
        changer(sel.id, { action: { type: "tir", cible: l[(i + 1) % l.length].e.id } });
        return;
      }
      if (e.key === "Backspace") { changer(sel.id, { chemin: o.chemin.slice(0, -1) }); e.preventDefault(); return; }
      if (e.code in TOUCHES) {
        const ici = destination(sel, o);
        if (o.chemin.length && terrain(carte!, ici) === "^") return;
        const v = voisin(ici, TOUCHES[e.code]);
        const chemin = [...o.chemin, v];
        if (!navigable(carte!, v) || chemin.length > pasMax(regles, sel.classe)
          || coutChemin(regles, meteo, sel.pos, chemin) > pointsMouvement(regles, sel.classe)) {
          setRefus("Pas par là : terre, récif déjà atteint ou plus assez de vent.");
          return;
        }
        changer(sel.id, { chemin });
      }
    };
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mien, planif, sel, meteo, brouillon, verrouiller, ciblesPour]);

  // ── scène du rendu ──
  const scene: Scene = useMemo(() => {
    const brume = vue.phase !== "fin" && enLice && actifs > 2 && meteo ? champDe(regles, meteo, mien) : null;
    const ciblesVues = planif
      ? mien.flatMap((n) => {
          const o = brouillon[n.id];
          if (o?.action.type !== "tir") return [];
          const cible = ennemis.find((e) => e.id === (o.action as { cible: string }).cible);
          if (!cible) return [];
          const de = destination(n, o);
          const [ok] = tirPossible(regles, carte!, n.classe, de, cible.pos);
          return [{ de, vers: cible.pos, possible: ok, chance: chance(regles, meteo!, n.classe, cible.classe, distance(de, cible.pos), false, !!o.chemin.length) }];
        })
      : [];
    return {
      carte: carte!, meteo, navires: vue.navires, fantomes: vue.phase === "fin" ? [] : vue.fantomes, moi, pavillons,
      ordres: planif ? brouillon : {}, selection, accessibles, risques, survol, champ: brume, ciblesVues,
      reduit: reglages.reduit, qualite: reglages.qualite,
    };
  }, [vue, carte, meteo, moi, pavillons, planif, brouillon, selection, accessibles, risques, survol, enLice, actifs, regles, mien, ennemis, reglages]);

  // Premier cadrage : sur ma flotte quand la carte entière serait illisible (téléphone).
  const cadre = useRef(false);
  useEffect(() => {
    if (cadre.current || !mien.length || !rendu.current) return;
    cadre.current = true;
    rendu.current.preferer(mien.map((n) => n.pos));
  }, [mien]);

  // ── affichage ──
  const reste = vue.echeance ? Math.max(0, vue.echeance - maintenant()) : 0;
  const total = vue.phase === "planification" ? vue.options.plan : vue.phase === "preparation" ? 8 : regles.resolution;
  const titrePhase = {
    salon: "", fin: "Fin de la bataille",
    preparation: "Les flottes se déploient",
    planification: enLice ? (joueur?.verrou ? "Ordres verrouillés — en attente des autres" : "Donne tes ordres") : "Les capitaines délibèrent",
    resolution: `La manche ${vue.manche - 1} se joue`,
  }[vue.phase];
  const historique = useMemo(() => [...vue.historique].reverse().map((h) => ({
    manche: h.manche,
    lignes: h.evts.map((e) => texteEvt(e, annuaire.current, moi, vue.joueurs, regles)).filter((l): l is NonNullable<typeof l> => !!l),
  })), [vue.historique, moi, vue.joueurs, regles]);
  const survolInfo = survol ? infoCase(survol) : null;

  function infoCase(c: Cell) {
    const t = terrain(carte!, c) ?? ".";
    const n = vue.navires.find((x) => !x.coule && memeCase(x.pos, c));
    const f = vue.fantomes.find((x) => memeCase(x.pos, c));
    const parts = [TERRAINS[t]?.nom ?? "Mer"];
    if (n) parts.push(`${n.nom} — ${regles.classes[n.classe].nom}, coque ${n.coque}/${n.max}`
      + (n.uid !== moi ? ` (${vue.joueurs.find((j) => j.uid === n.uid)?.nom ?? "?"})` : ""));
    else if (f) parts.push(`Dernière position connue de « ${f.nom} » (manche ${f.manche})`);
    if (sel && accessibles?.has(cle(c)) && meteo) {
      const ch = accessibles.get(cle(c))!;
      parts.push(`${ch.length} pas, ${coutChemin(regles, meteo, sel.pos, ch)}/${pointsMouvement(regles, sel.classe)} pts de vent`);
      const gene = occupees(sel.id).get(cle(c));
      if (gene) parts.push(`⚠ « ${gene.nom} » y sera : collision avec ta propre flotte`);
    }
    return parts.join(" · ");
  }

  return (
    <div className="fl-jeu">
      <header className="fl-bandeau">
        <div className="fl-manche">
          <span className="fl-manche-num">Manche {Math.min(vue.manche, vue.options.manches)}<small>/{vue.options.manches}</small></span>
          <span className="fl-phase">{titrePhase}</span>
        </div>
        {vue.echeance && vue.phase !== "fin" && (
          <div className={`fl-chrono${reste < 10 && vue.phase === "planification" ? " urgent" : ""}`} role="timer"
            aria-label={`${Math.ceil(reste)} secondes restantes`}>
            <svg viewBox="0 0 36 36" width="42" height="42" aria-hidden="true">
              <circle cx="18" cy="18" r="15.5" className="fl-chrono-fond" />
              <circle cx="18" cy="18" r="15.5" className="fl-chrono-arc"
                strokeDasharray={`${(97.4 * Math.min(1, reste / Math.max(1, total))).toFixed(1)} 97.4`} />
            </svg>
            <span>{Math.ceil(reste)}</span>
          </div>
        )}
        {meteo && (
          <div className="fl-meteo" title={`Prévision : ${vue.prevision ? regles.temps[vue.prevision.temps].nom : "?"}`}>
            <RoseDesVents vent={meteo.vent} />
            <div>
              <strong><PictoTemps temps={meteo.temps} taille={16} /> {regles.temps[meteo.temps].nom}</strong>
              {vue.prevision && <small>ensuite : {regles.temps[vue.prevision.temps].nom}</small>}
            </div>
          </div>
        )}
        <ul className="fl-capitaines" aria-label="Capitaines">
          {vue.joueurs.map((j) => (
            <li key={j.uid} className={`${j.elimine !== null || j.abandon ? "hors" : ""}${j.uid === moi ? " moi" : ""}`}
              style={{ "--camp": PAVILLONS[j.pavillon].couleur } as React.CSSProperties}>
              <Embleme id={j.pavillon} taille={16} />
              <span className="nom">{j.nom}</span>
              <span className="nb" aria-label={`${j.navires} navires à flot`} title={`${j.navires} navires à flot`}>
                {j.navires}
                <svg viewBox="0 0 16 12" width="13" height="10" aria-hidden="true"><path d="M1 8h14l-2.5 3.5h-9ZM7.5 1v6.2H3.2ZM8.5 2.2l4 5H8.5Z" fill="currentColor" /></svg>
              </span>
              {vue.phase === "planification" && j.elimine === null && !j.abandon && (
                <span className={`verrou${j.verrou || j.bot ? " ok" : ""}`} aria-label={j.verrou || j.bot ? "a verrouillé" : "réfléchit"}>
                  {j.verrou || j.bot ? "✓" : "…"}
                </span>
              )}
              {!j.bot && !vue.connectes.includes(j.uid) && j.elimine === null && !j.abandon && <span className="absent" title="Déconnecté">⚠</span>}
            </li>
          ))}
        </ul>
        <div className="fl-outils">
          <button className={`fl-btn-icone${reglages.son ? " actif" : ""}`} onClick={() => changerReglages({ ...reglages, son: !reglages.son })}
            aria-pressed={reglages.son} aria-label={reglages.son ? "Couper le son" : "Activer le son"} title={reglages.son ? "Son activé" : "Son coupé"}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" />
              {reglages.son ? <path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" /> : <path d="m16 9.5 5 5m0-5-5 5" />}
            </svg>
          </button>
          <button className="fl-btn-icone" onClick={surAide} aria-label="Aide et règles" title="Aide (règles, touches)">?</button>
          <button className="fl-btn fl-btn-petit" onClick={surQuitter} aria-label="Quitter la partie">Quitter</button>
        </div>
      </header>

      <main className="fl-scene">
        <Carte scene={scene} rendu={rendu} surCase={surCase} surSurvol={setSurvol}
          etiquette={`Carte marine, manche ${vue.manche}. ${mien.length} navires sous tes ordres.`} />
        <div className="fl-zoom">
          <button onClick={() => rendu.current?.zoomer(1.25)} aria-label="Zoomer">+</button>
          <button onClick={() => rendu.current?.zoomer(0.8)} aria-label="Dézoomer">−</button>
          <button onClick={() => rendu.current?.ajuster()} aria-label="Voir toute la carte" title="Toute la carte">⤢</button>
          {mien[0] && <button onClick={() => rendu.current?.centrerSur((sel ?? mien[0]).pos)} aria-label="Recentrer sur ma flotte" title="Ma flotte (C)">⌖</button>}
        </div>
        {survolInfo && <div className="fl-survol">{survolInfo}</div>}
        {banniere && (
          <div key={banniere.cle} className={`fl-banniere${banniere.breve ? " breve" : ""}`} aria-live="polite">
            <strong>{banniere.titre}</strong>
            <span>{banniere.sous}</span>
          </div>
        )}
        {vue.phase === "preparation" && <div className="fl-annonce">Les flottes se déploient… <strong>{Math.ceil(reste)}</strong></div>}
        {refus && <div className="fl-refus" role="alert">{refus}</div>}
        {!enLice && joueur && vue.phase !== "fin" && (
          <div className="fl-annonce sombre">
            {joueur.abandon ? "Tu as amené ton pavillon." : "Ta flotte a sombré."} La bataille continue sans toi.
          </div>
        )}
      </main>

      <aside className="fl-panneau" aria-label="Ma flotte">
        {enLice && vue.absences > 0 && vue.phase !== "fin" && (
          <p className="fl-alerte" role="alert">
            Aucun ordre reçu à la dernière manche ({vue.absences}/{vue.absences_max}) : tes navires se sont mis en garde.
            À {vue.absences_max}, ta flotte amène son pavillon.
          </p>
        )}
        <h2>Ma flotte {joueur && <Pavillon id={joueur.pavillon} taille={30} titre />}</h2>
        {!mien.length && <p className="fl-doux">Plus aucun navire sous tes ordres.</p>}
        <ol className="fl-navires">
          {mien.map((n, i) => {
            const o = ordreDe(n.id);
            const choisi = n.id === selection;
            const k = regles.classes[n.classe];
            const cout = meteo ? coutChemin(regles, meteo, n.pos, o.chemin) : 0;
            const cibles = choisi ? ciblesPour(n) : [];
            const cibleNom = o.action.type === "tir" ? ennemis.find((e) => e.id === (o.action as { cible: string }).cible) : null;
            return (
              <li key={n.id} className={choisi ? "choisi" : ""}>
                <button className="fl-navire-tete" onClick={() => { setSelection(choisi ? null : n.id); if (!choisi) rendu.current?.centrerSur(n.pos); }}
                  aria-expanded={choisi}>
                  <span className="touche">{i + 1}</span>
                  <span className="nom">« {n.nom} »<small>{k.nom}</small></span>
                  <span className="coque" aria-label={`Coque ${n.coque} sur ${n.max}`}>
                    {Array.from({ length: n.max }, (_, j) => <i key={j} className={j < n.coque ? "plein" : ""} />)}
                  </span>
                </button>
                {planif && occupees(n.id).has(cle(destination(n, o))) && (
                  <p className="fl-risque">⚠ Collision prévue avec « {occupees(n.id).get(cle(destination(n, o)))!.nom} » (−1 chacun)</p>
                )}
                <p className="fl-ordre-resume">
                  {o.chemin.length ? `Cap : ${o.chemin.length} pas (${cout}/${pointsMouvement(regles, n.classe)} pts)` : "Reste en place"}
                  {" · "}
                  {o.action.type === "tir" ? `Feu sur « ${cibleNom?.nom ?? "?"} »` : "En garde (−15 % pour qui le vise)"}
                </p>
                {choisi && planif && (
                  <div className="fl-ordre">
                    <p className="fl-doux">
                      Clique une case dorée pour fixer le cap (ou touches {AZERTY.join(" ")} autour de S, Retour arrière pour annuler un pas).
                      Portée {k.portee_min > 1 ? `${k.portee_min}–` : ""}{k.portee} · {k.degats} dégât{k.degats > 1 ? "s" : ""} · vision {k.vision}.
                    </p>
                    <div className="fl-actions">
                      <button className={o.action.type === "garde" ? "actif" : ""} onClick={() => changer(n.id, { action: { type: "garde" } as Action })}>
                        🛡 Garde
                      </button>
                      {o.chemin.length > 0 && <button onClick={() => changer(n.id, { chemin: [] })}>⚓ Rester en place</button>}
                    </div>
                    {cibles.length ? (
                      <ul className="fl-cibles" aria-label="Cibles en vue">
                        {cibles.map(({ e, ok, raison, dist, p }) => {
                          const vise = o.action.type === "tir" && (o.action as { cible: string }).cible === e.id;
                          return (
                            <li key={e.id}>
                              <button className={vise ? "actif" : ""} onClick={() => changer(n.id, { action: vise ? { type: "garde" } : { type: "tir", cible: e.id } })}
                                style={{ "--camp": PAVILLONS[pavillons[e.uid]].couleur } as React.CSSProperties}>
                                <Embleme id={pavillons[e.uid]} taille={14} />
                                <span>« {e.nom} » <small>{regles.classes[e.classe].nom}, {dist} case{dist > 1 ? "s" : ""}</small></span>
                                <strong className={ok ? "" : "non"}>{ok ? `${p} %` : raison}</strong>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : <p className="fl-doux">Aucun ennemi en vue. Les éclaireurs voient le plus loin.</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {planif && (
          <button className={`fl-btn-principal${joueur?.verrou ? " verrouille" : ""}`} onClick={verrouiller}>
            {joueur?.verrou ? "Ordres verrouillés — modifier" : "Verrouiller mes ordres (Entrée)"}
          </button>
        )}
        {meteo && (
          <details className="fl-allures">
            <summary>Coût du vent ({regles.temps[meteo.temps].nom})</summary>
            <ul>
              {ALLURES.map((a, i) => <li key={a}>{a} : <strong>{regles.temps[meteo.temps].couts[i]}</strong> pt{regles.temps[meteo.temps].couts[i] > 1 ? "s" : ""}/case</li>)}
            </ul>
            <p className="fl-doux">Points par manche : vitesse × {regles.points}. Le vent pousse vers la flèche dorée.</p>
          </details>
        )}
      </aside>

      <section className={`fl-journal${journal ? "" : " replie"}`} aria-label="Journal de bord">
        <button className="fl-journal-tete" onClick={() => setJournal(!journal)} aria-expanded={journal}>
          Journal de bord {journal ? "▾" : "▸"}
        </button>
        {journal && (
          <div className="fl-journal-corps" aria-live="polite">
            {historique.length === 0 && <p className="fl-doux">Le calme avant la tempête…</p>}
            {historique.map((h) => (
              <div key={h.manche}>
                <h3>Manche {h.manche}</h3>
                {h.lignes.length ? (
                  <ul>{h.lignes.map((l, i) => <li key={i} className={l.ton}>{l.texte}</li>)}</ul>
                ) : <p className="fl-doux">Rien à signaler en vue.</p>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
