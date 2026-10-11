"use client";

// Les Ombres de la Taverne — page de jeu. L'état vit dans La Fripouille, qui envoie à
// chacun SA vue (déjà filtrée) par un flux SSE ; chaque geste part en POST sur le ticket.
// Ici : mise en scène (jour/nuit, cinématiques, son), table, panneaux d'action, console
// du MJ, journal. Aucune règle n'est décidée côté navigateur.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AmbianceSonore } from "@/lib/ambiance-sonore";
import { OmbresSon, type Bruitage } from "@/lib/ombres-son";
import {
  CAMPS, CARTES, CAUSES, ORDRE_ROLES, PHASES, RETIRABLES, ROLES,
  type CarteId, type Entree, type Joueur, type Partie, type RoleId, type Vue,
} from "@/lib/ombres";
import Braises from "./Braises";
import Table, { type Fil, type Marque } from "./Table";
import { CarteEvenement, CarteRole } from "./Carte";
import { Embleme } from "./Emblemes";

type Urls = { flux_url: string; op_url: string };
type Cine =
  | { genre: "phase"; titre: string; sous: string; nuit: boolean; cle: string }
  | { genre: "morts"; cle: string }
  | { genre: "verdict"; cle: string }
  | { genre: "fin"; cle: string };

const NOM_JOUEUR = (p: Partie | null, uid: string | null | undefined) =>
  (uid && p?.joueurs.find((j) => j.uid === uid)?.nom) || "personne";

// ─────────────────────────── Machine à écrire ───────────────────────────
function Machine({ texte, vitesse = 24 }: { texte: string; vitesse?: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setN(texte.length); return; }
    const t = setInterval(() => setN((k) => (k >= texte.length ? (clearInterval(t), k) : k + 1)), vitesse);
    return () => clearInterval(t);
  }, [texte, vitesse]);
  return (
    <span className="om-machine" onClick={() => setN(texte.length)}>
      {texte.slice(0, n)}
      {n < texte.length && <span className="om-curseur">▌</span>}
    </span>
  );
}

export default function Ombres({ scene }: { scene?: string }) {
  const estScene = scene !== undefined;
  const [vue, setVue] = useState<Vue | null>(null);
  const [urls, setUrls] = useState<Urls | null>(null);
  const [connexion, setConnexion] = useState<"attente" | "direct" | "perdue">("attente");
  const [erreur, setErreur] = useState<string | null>(null);
  const [refus, setRefus] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [filtre, setFiltre] = useState<"tout" | "recit" | "votes" | "secrets">("tout");
  const [sonActif, setSonActif] = useState(false);
  const [stream, setStream] = useState(false);
  const [regles, setRegles] = useState(false);
  const [cine, setCine] = useState<Cine | null>(null);
  const [onglet, setOnglet] = useState<"jeu" | "journal" | "mj">("jeu");
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [convertir, setConvertir] = useState(false);
  const [murmure, setMurmure] = useState("");
  const [testament, setTestament] = useState<string | null>(null);
  const [aubeMJ, setAubeMJ] = useState<string | null>(null);
  const [copie, setCopie] = useState(false);
  const decalage = useRef(0);
  const sfx = useRef<OmbresSon | null>(null);
  const ambiance = useRef<AmbianceSonore | null>(null);
  const totalRef = useRef<number | null>(null);

  const p = vue?.partie ?? null;
  const moi = p?.joueurs.find((j) => j.uid === p.moi) ?? null;
  const perso = p?.perso ?? null;
  const phase = p?.phase ?? "hall";
  const nuit = !!p && PHASES[phase].nuit;
  const estMJ = !!p?.est_mj;

  // ─────────────── Connexion temps réel ───────────────
  useEffect(() => {
    let es: EventSource | null = null;
    let vivant = true;
    let recu = false;
    let relance: ReturnType<typeof setTimeout> | null = null;
    const plusTard = (ms: number) => {
      if (relance) clearTimeout(relance);
      if (vivant) relance = setTimeout(connecter, ms);
    };
    const brancher = (url: string) => {
      es = new EventSource(url);
      es.onopen = () => { setConnexion("direct"); setErreur(null); };
      es.onerror = () => {
        setConnexion("perdue");
        if (estScene && !recu) setErreur("Ce lien de scène n'est plus valable : demande un lien à jour au Maître du jeu.");
        if (es?.readyState === EventSource.CLOSED) plusTard(estScene && !recu ? 15000 : 3000);
      };
      es.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.type !== "etat") return;
        recu = true;
        const t = m.partie?.maintenant ?? m.maintenant;
        if (t) decalage.current = t - Date.now() / 1000;
        setVue(m);
      };
    };
    const connecter = async () => {
      es?.close();
      if (estScene) {
        if (!scene) { setErreur("Lien de scène invalide : demande au MJ un lien à jour."); return; }
        brancher(scene);
        return;
      }
      try {
        const r = await fetch("/api/ombres/ticket", { method: "POST" });
        if (r.status === 403) {
          const e = await r.json().catch(() => ({}));
          setErreur(e.error || "Accès refusé.");
          return;
        }
        if (!r.ok) throw new Error();
        const u: Urls = await r.json();
        if (!vivant) return;
        setUrls(u);
        brancher(u.flux_url);
      } catch {
        setConnexion("perdue");
        setErreur("La taverne ne répond pas — nouvel essai dans quelques secondes…");
        plusTard(5000);
      }
    };
    connecter();
    return () => { vivant = false; if (relance) clearTimeout(relance); es?.close(); };
  }, [estScene, scene]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000 + decalage.current), 250);
    return () => clearInterval(t);
  }, []);

  const op = useCallback(async (corps: Record<string, unknown>) => {
    if (!urls) return false;
    try {
      const r = await fetch(urls.op_url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setRefus(d.error || "Geste refusé."); return false; }
      return true;
    } catch {
      setRefus("La taverne ne répond pas.");
      return false;
    }
  }, [urls]);

  useEffect(() => {
    if (!refus) return;
    const t = setTimeout(() => setRefus(null), 3800);
    return () => clearTimeout(t);
  }, [refus]);

  // ─────────────── Son ───────────────
  const bruit = useCallback((b: Bruitage) => { if (sonActif) sfx.current?.jouer(b); }, [sonActif]);
  useEffect(() => {
    if (!sonActif) { ambiance.current?.arreter(); return; }
    if (!ambiance.current) ambiance.current = new AmbianceSonore();
    if (!sfx.current) sfx.current = new OmbresSon();
    ambiance.current.volume(0.4);
    ambiance.current.jouer(nuit ? "nuit" : "taverne");
  }, [sonActif, nuit]);
  useEffect(() => () => { ambiance.current?.fermer(); sfx.current?.fermer(); }, []);

  // ─────────────── Temps ───────────────
  const reste = p ? (p.pause ?? (p.echeance ? Math.max(0, p.echeance - now) : null)) : null;
  if (p?.echeance && p.debut) totalRef.current = p.echeance - p.debut;
  const total = p?.pause != null ? totalRef.current : p?.echeance && p.debut ? p.echeance - p.debut : null;
  const secondeEntiere = reste !== null ? Math.ceil(reste) : null;
  useEffect(() => {
    if (secondeEntiere === null || p?.pause != null) return;
    if (secondeEntiere > 0 && secondeEntiere <= 10 && ["nuit", "debat", "conseil", "videur"].includes(phase)) bruit("tic");
  }, [secondeEntiere]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────── Chorégraphie des phases ───────────────
  const avant = useRef<{ id: string; phase: string; jour: number; proclamee: boolean } | null>(null);
  useEffect(() => {
    if (!p) { avant.current = null; return; }
    const prec = avant.current;
    const proclamee = !!p.aube?.proclamee;
    avant.current = { id: p.id, phase: p.phase, jour: p.jour, proclamee };
    if (!prec || prec.id !== p.id) {
      if (p.phase === "fin" && prec) setCine({ genre: "fin", cle: p.id });
      return;                                 // premier état reçu : pas de cinématique rétroactive
    }
    if (prec.phase !== p.phase) {
      setSelection([]);
      setConvertir(false);
      const ph = PHASES[p.phase];
      if (p.phase === "nuit") { setCine({ genre: "phase", titre: `Nuit ${p.nuit}`, sous: "La nuit tombe sur la taverne…", nuit: true, cle: `n${p.nuit}` }); bruit("souffle"); }
      else if (p.phase === "aube") { setCine({ genre: "phase", titre: `Jour ${p.jour}`, sous: "L'aube se lève sur la taverne", nuit: false, cle: `a${p.jour}` }); bruit("cloche"); }
      else if (p.phase === "conseil") { setCine({ genre: "phase", titre: "Le Conseil", sous: ph.sous, nuit: false, cle: `c${p.jour}` }); bruit("cloche"); }
      else if (p.phase === "verdict") { setCine({ genre: "verdict", cle: `v${p.jour}` }); bruit(p.verdict?.chasse ? "glas" : "papier"); }
      else if (p.phase === "fin") { setCine({ genre: "fin", cle: p.id }); bruit("victoire"); }
      else if (p.phase === "videur") bruit("epee");
      else if (p.phase === "alchimie" && perso?.role === "alchimiste") bruit("fiole");
      else if (p.phase === "distribution") bruit("papier");
    }
    if (p.phase === "aube" && proclamee && !prec.proclamee) {
      setTimeout(() => setCine({ genre: "morts", cle: `m${p.jour}` }), 900);
      if (p.aube?.morts.length) setTimeout(() => bruit("glas"), 1000);
    }
  }, [p?.id, p?.phase, p?.jour, p?.aube?.proclamee]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!cine || cine.genre === "fin") return;
    const t = setTimeout(() => setCine(null), cine.genre === "phase" ? 2600 : cine.genre === "morts" ? 11000 : 6500);
    return () => clearTimeout(t);
  }, [cine]);

  useEffect(() => { if (estMJ) setOnglet((o) => (o === "jeu" ? "mj" : o)); }, [estMJ]);

  // ─────────────── Choix sur la table ───────────────
  const vivants = useMemo(() => p?.joueurs.filter((j) => j.vivant) ?? [], [p]);
  const choix = useMemo(() => {
    if (!p || !perso || !moi?.vivant || estScene) return null;
    const ids = (f: (j: Joueur) => boolean) => new Set(vivants.filter(f).map((j) => j.uid));
    const r = perso.role;
    if (phase === "nuit") {
      if (r === "cultiste" || r === "voix") return { genre: "ombres" as const, max: 1, cibles: ids((j) => j.camp !== "ombres") };
      if (r === "inquisiteur") return { genre: "agir" as const, max: p.evenement === "lanterne" ? 2 : 1, cibles: ids((j) => j.uid !== moi.uid) };
      if (r === "paladin") return { genre: "agir" as const, max: 1, cibles: ids((j) => j.uid !== perso.memo?.dernier) };
      if (r === "tavernier") return { genre: "agir" as const, max: 1, cibles: ids((j) => j.uid !== moi.uid && j.uid !== perso.memo?.dernier) };
      if (r === "barde") return { genre: "agir" as const, max: 2, cibles: ids((j) => j.uid !== moi.uid && !j.enchante) };
    }
    if (phase === "alchimie" && r === "alchimiste" && perso.alchimie && !perso.alchimie.fait && perso.memo?.fiole_mort)
      return { genre: "poison" as const, max: 1, cibles: ids((j) => j.uid !== moi.uid) };
    if (phase === "conseil" && p.muet !== moi.uid) return { genre: "conseil" as const, max: 1, cibles: ids((j) => j.uid !== moi.uid) };
    if (phase === "videur" && p.videur === moi.uid) return { genre: "videur" as const, max: 1, cibles: ids(() => true) };
    return null;
  }, [p, perso, moi, phase, vivants, estScene]);

  const surSiege = async (uid: string) => {
    if (!choix) return;
    if (choix.genre === "ombres") {
      bruit("papier");
      await op({ op: "agir", vote: uid, ...(perso?.role === "voix" ? { convertir } : {}) });
      return;
    }
    if (choix.genre === "conseil") {
      bruit("papier");
      await op({ op: "voter", cible: perso?.mon_vote === uid ? "" : uid });
      return;
    }
    setSelection((s) => (s.includes(uid) ? s.filter((x) => x !== uid) : choix.max === 1 ? [uid] : [...s, uid].slice(-choix.max)));
  };

  const confirmer = async () => {
    if (!choix || !selection.length) return;
    let ok = false;
    if (choix.genre === "agir") ok = await op({ op: "agir", cibles: selection });
    else if (choix.genre === "videur") ok = await op({ op: "tir", cible: selection[0] });
    else if (choix.genre === "poison") ok = await op({ op: "agir", mort: selection[0], vie: "" });
    if (ok) {
      bruit(choix.genre === "videur" ? "epee" : choix.genre === "poison" ? "fiole" : "papier");
      setSelection([]);
    }
  };

  // ─────────────── Fils & marques ───────────────
  const fils = useMemo<Fil[]>(() => {
    if (!p) return [];
    const out: Fil[] = [];
    if ((phase === "conseil" || phase === "verdict") && p.votes && !p.votes.secret)
      for (const [de, vers] of Object.entries(p.votes.liste)) if (vers) out.push({ de, vers, genre: "conseil" });
    const vo = p.secrets?.votes_ombres ?? perso?.votes_ombres;
    if ((phase === "nuit" || phase === "alchimie") && vo)
      for (const [de, vers] of Object.entries(vo)) if (vers) out.push({ de, vers, genre: "ombres" });
    if (p.secrets && (phase === "nuit" || phase === "alchimie")) {
      for (const [de, a] of Object.entries(p.secrets.actions)) {
        const r = p.joueurs.find((j) => j.uid === de)?.role;
        if (!a.cibles || !r || r === "voix") continue;
        for (const c of a.cibles) out.push({ de, vers: c, genre: r as Fil["genre"] });
      }
      const al = p.secrets.alchimie;
      const alchi = p.joueurs.find((j) => j.role === "alchimiste")?.uid;
      if (alchi && al?.mort) out.push({ de: alchi, vers: al.mort, genre: "alchimiste" });
    }
    if (perso?.action?.cibles && phase === "nuit" && moi)
      for (const c of perso.action.cibles) out.push({ de: moi.uid, vers: c, genre: (perso.role as Fil["genre"]) || "inquisiteur" });
    return out;
  }, [p, phase, perso, moi]);

  const marques = useMemo(() => {
    const m: Record<string, Marque[]> = {};
    if (!p) return m;
    const ajouter = (u: string, x: Marque) => { (m[u] ||= []).includes(x) || m[u].push(x); };
    if (p.muet) ajouter(p.muet, "muet");
    for (const j of p.joueurs) if (j.enchante && j.vivant) ajouter(j.uid, "enchante");
    const s = p.secrets;
    if (s && (phase === "nuit" || phase === "alchimie")) {
      for (const [de, a] of Object.entries(s.actions)) {
        const r = p.joueurs.find((j) => j.uid === de)?.role;
        if (r === "paladin" && a.cibles) ajouter(a.cibles[0], "protege");
        if (r === "tavernier" && a.cibles) ajouter(a.cibles[0], "servi");
      }
      for (const c of s.cibles) ajouter(c, "cible");
      if (s.alchimie?.mort) ajouter(s.alchimie.mort, "poison");
    }
    if (perso?.alchimie?.cibles) for (const c of perso.alchimie.cibles) ajouter(c, "cible");
    return m;
  }, [p, phase, perso]);

  // ─────────────── Écrans hors partie ───────────────
  if (erreur && !vue) {
    return (
      <div className="ombres"><Braises nuit /><div className="om-voile-fond" />
        <div className="om-message"><Embleme role="dos" taille={90} /><h1>Les Ombres de la Taverne</h1><p>{erreur}</p></div>
      </div>
    );
  }
  if (!vue) return <div className="om-chargement">On allume les chandelles…</div>;

  const peut = vue.peut;
  const hote = p && vue.moi.uid && p.hote === vue.moi.uid;
  const reglant = !!p && p.phase === "hall" && (hote || estMJ || vue.moi.role === "admin");
  const assis = !!moi;
  const lienScene = vue.cle_scene && typeof window !== "undefined" ? `${window.location.origin}/ombres/scene?cle=${vue.cle_scene}` : "";

  // ─────────────── Centre de la table ───────────────
  // Le sous-titre du centre n'apparaît que lorsqu'il informe (l'anneau du temps l'entoure).
  let centre = PHASES[phase].titre, sous = "";
  if (!p) { centre = "Aucune table ouverte"; sous = "Ouvre une partie pour commencer"; }
  else if (phase === "hall") { centre = `${p.joueurs.length} convive${p.joueurs.length > 1 ? "s" : ""}`; sous = p.joueurs.length < 6 ? `Encore ${6 - p.joueurs.length} pour commencer` : "La table est prête"; }
  else if (phase === "nuit") centre = `Nuit ${p.nuit}`;
  else if (phase === "aube" || phase === "debat" || phase === "conseil") centre = `Jour ${p.jour}`;
  else if (phase === "verdict") sous = p.verdict?.chasse ? `${NOM_JOUEUR(p, p.verdict.chasse)} est chassé` : "Personne n'est chassé";
  else if (phase === "fin" && p.fin) { centre = "Fin de partie"; sous = p.fin.titre; }

  const places = p?.phase === "hall" ? Math.max(0, 6 - p.joueurs.length) : 0;

  // ─────────────── Panneaux ───────────────
  const panneauJeu = (
    <div className="om-panneau-jeu">
      {!p || p.phase === "fin" ? (
        <section className="om-bloc">
          <h2>{p ? "Une autre partie ?" : "La salle est vide"}</h2>
          <p className="om-doux">
            Des Ombres se cachent parmi les convives. Le jour, on débat en vocal et on chasse un suspect ; la nuit, chacun use de son pouvoir en secret.
          </p>
          {p?.phase === "fin" && (peut.arbitre || hote) && (
            <button type="button" className="om-bouton or" onClick={() => op({ op: "rejouer" })}>Rejouer avec la même tablée</button>
          )}
          {peut.ouvrir && !estScene && (
            <div className="om-rangee">
              <button type="button" className="om-bouton or" onClick={() => op({ op: "ouvrir", mode: "auto" })}>Ouvrir une table</button>
              {peut.ouvrir_mj && (
                <button type="button" className="om-bouton" onClick={() => op({ op: "ouvrir", mode: "mj" })}>Ouvrir en Maître du jeu</button>
              )}
            </div>
          )}
          <button type="button" className="om-lien" onClick={() => setRegles(true)}>Lire les règles et les rôles</button>
        </section>
      ) : p.phase === "hall" ? (
        <PanneauHall p={p} assis={assis} reglant={reglant} pantins={peut.pantins} estMJ={estMJ} op={op} estScene={estScene} />
      ) : (
        <>
          {perso && moi && (
            <section className={`om-bloc om-ma-carte${stream ? " voile" : ""}`}>
              <CarteRole role={perso.role} maintenir={moi.vivant} ouverte={!moi.vivant} taille="m" onRetourne={() => bruit("papier")} />
              <div className="om-ma-carte-infos">
                <div className="om-etat-moi">{moi.vivant ? "Tu es en vie" : `Tu es mort — ${CAUSES[moi.mort?.cause || ""] || ""}`}</div>
                {perso.enchante && <div className="om-enchante">Sous le charme du Barde</div>}
                {moi.vivant && (
                  <div className="om-testament">
                    <label htmlFor="om-testament">Dernières volontés</label>
                    <input id="om-testament" maxLength={80} placeholder="Lues à voix haute si tu tombes…"
                      value={testament ?? moi.testament ?? ""} onChange={(e) => setTestament(e.target.value)}
                      onBlur={() => { if (testament !== null) { op({ op: "testament", texte: testament }); setTestament(null); } }} />
                  </div>
                )}
              </div>
            </section>
          )}
          <PanneauAction p={p} moi={moi} choix={choix} selection={selection} confirmer={confirmer} op={op}
            convertir={convertir} setConvertir={setConvertir} bruit={bruit} />
          {perso?.conciliabule && (
            <section className={`om-bloc om-conciliabule${stream ? " voile" : ""}`}>
              <h3>Conciliabule des Ombres</h3>
              <div className="om-murmures">
                {perso.conciliabule.length === 0 && <p className="om-doux">Personne n'a encore murmuré.</p>}
                {perso.conciliabule.map((m, i) => (
                  <p key={i}><strong>{m.nom}</strong> {m.texte}</p>
                ))}
              </div>
              {moi?.vivant && (
                <form onSubmit={(e) => { e.preventDefault(); if (murmure.trim()) { op({ op: "murmure", texte: murmure }); setMurmure(""); } }}>
                  <input value={murmure} onChange={(e) => setMurmure(e.target.value)} maxLength={200} placeholder="Murmurer aux tiens…" />
                  <button type="submit" className="om-bouton petit">Murmurer</button>
                </form>
              )}
            </section>
          )}
          {perso && perso.infos.length > 0 && (
            <section className={`om-bloc om-secrets${stream ? " voile" : ""}`}>
              <h3>Ce que tu sais</h3>
              {[...perso.infos].reverse().map((i, k) => (
                <p key={k} className={`om-info om-info-${i.nature}`}><span>{i.nuit ? `Nuit ${i.nuit}` : "Début"}</span>{i.texte}</p>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );

  const journal = <Journal p={p} filtre={filtre} setFiltre={setFiltre} />;

  return (
    <div className={`ombres phase-${phase}${nuit ? " nuit" : ""}${estScene ? " scene" : ""}`}>
      <Braises nuit={nuit} />
      <div className="om-voile-fond" />
      <div className="om-brume" aria-hidden="true"><span /><span /></div>

      <header className="om-entete">
        <div className="om-titre">
          <Embleme role="dos" taille={34} />
          <div>
            <h1>Les Ombres de la Taverne</h1>
            <span>{p ? `${PHASES[phase].titre}${p.jour ? ` · jour ${p.jour}` : ""}${p.mode === "mj" ? " · avec MJ" : ""}` : "La Taverne du Gaming"}</span>
          </div>
        </div>
        <div className="om-outils">
          {p?.evenement && phase !== "hall" && (
            <span title={`${CARTES[p.evenement].nom} — ${CARTES[p.evenement].texte}`}><CarteEvenement carte={p.evenement} petite /></span>
          )}
          <span className={`om-connexion ${connexion}`} title={connexion === "direct" ? "En direct" : "Connexion perdue"}>
            {vue.presents} présent{vue.presents > 1 ? "s" : ""}
          </span>
          <button type="button" className={`om-icone${sonActif ? " actif" : ""}`} onClick={() => setSonActif((v) => !v)} aria-pressed={sonActif} title="Son et ambiance">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />{sonActif ? <path d="M16 8q3 4 0 8M18.5 5.5q5 6.5 0 13" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /> : <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}</svg>
          </button>
          {!estScene && perso && (
            <button type="button" className={`om-icone${stream ? " actif" : ""}`} onClick={() => setStream((v) => !v)} aria-pressed={stream} title="Mode stream : tes secrets restent flous tant que tu ne les survoles pas">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M16 10l5-3v10l-5-3z" fill="currentColor" /></svg>
            </button>
          )}
          <button type="button" className="om-icone" onClick={() => setRegles(true)} title="Règles et rôles">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4z" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M9 9h6M9 13h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
          {vue.moi.role === "admin" && !estScene && <a className="om-icone" href="/" title="Retour au panneau">↩</a>}
        </div>
      </header>

      {peut.arbitre && p && !["hall", "fin"].includes(phase) && !estMJ && (
        <Arbitrage p={p} op={op} />
      )}

      <main className="om-scene">
        <div className="om-colonne-table">
          <Table joueurs={p?.joueurs ?? []} moi={p?.moi ?? null} nuit={nuit} selection={selection}
            selectionnables={choix?.cibles ?? null} onSiege={surSiege}
            onRetirer={reglant ? (uid) => op({ op: "renvoyer", uid }) : undefined}
            fils={fils} compte={(phase === "conseil" || phase === "verdict") ? p?.votes?.decompte ?? {} : {}}
            marques={marques} reste={phase === "hall" || phase === "fin" ? null : reste} total={total}
            enPause={p?.pause != null} centre={centre} sous={sous}
            surbrillance={phase === "verdict" ? p?.verdict?.chasse : phase === "videur" ? p?.videur : null}
            places={places} />
          {choix && <p className="om-consigne">{CONSIGNES[choix.genre](choix.max)}</p>}
        </div>

        {estScene ? (
          <aside className="om-cote">{journal}</aside>
        ) : (
          <aside className="om-cote">
            <nav className="om-onglets" role="tablist">
              <button type="button" role="tab" aria-selected={onglet === "jeu"} className={onglet === "jeu" ? "actif" : ""} onClick={() => setOnglet("jeu")}>Ta partie</button>
              {estMJ && <button type="button" role="tab" aria-selected={onglet === "mj"} className={onglet === "mj" ? "actif" : ""} onClick={() => setOnglet("mj")}>Console du MJ</button>}
              <button type="button" role="tab" aria-selected={onglet === "journal"} className={onglet === "journal" ? "actif" : ""} onClick={() => setOnglet("journal")}>Journal</button>
            </nav>
            <div className="om-onglet-corps">
              {onglet === "jeu" && panneauJeu}
              {onglet === "mj" && estMJ && p?.phase === "hall" && panneauJeu}
              {onglet === "mj" && estMJ && p && (
                <ConsoleMJ p={p} op={op} aubeMJ={aubeMJ} setAubeMJ={setAubeMJ} lienScene={lienScene} copie={copie}
                  copier={() => { navigator.clipboard?.writeText(lienScene); setCopie(true); setTimeout(() => setCopie(false), 1800); }} />
              )}
              {onglet === "journal" && journal}
            </div>
            {lienScene && !estMJ && (p?.phase === "hall" || !p) && (
              <button type="button" className="om-lien om-lien-scene" onClick={() => { navigator.clipboard?.writeText(lienScene); setCopie(true); setTimeout(() => setCopie(false), 1800); }}>
                {copie ? "Lien copié !" : "Copier le lien de scène (stream)"}
              </button>
            )}
          </aside>
        )}
      </main>

      {phase === "distribution" && perso && !estScene && (
        <div className="om-cine om-cine-distribution">
          <div className="om-cine-titre">Ta carte</div>
          <p className="om-cine-sous">Maintiens-la pour découvrir ton rôle — en secret.</p>
          <CarteRole role={perso.role} maintenir taille="l" onRetourne={() => bruit("papier")} />
        </div>
      )}
      {cine && <Cinematique cine={cine} p={p} fermer={() => setCine(null)} op={op} peutRejouer={!!(peut.arbitre || hote)} />}
      {regles && <Regles fermer={() => setRegles(false)} />}
      {refus && <div className="om-toast" role="alert">{refus}</div>}
      {connexion === "perdue" && vue && <div className="om-toast doux">Connexion perdue — on se rebranche…</div>}
    </div>
  );
}

const CONSIGNES: Record<string, (max: number) => string> = {
  ombres: () => "Clique sur ta proie. Tes frères voient ton choix en violet.",
  agir: (max) => (max > 1 ? "Choisis jusqu'à deux âmes autour de la table, puis scelle ton choix." : "Choisis une âme autour de la table, puis scelle ton choix."),
  poison: () => "Pour verser la fiole de mort, désigne sa cible.",
  conseil: () => "Clique sur ton suspect. Re-clique pour retirer ta voix.",
  videur: () => "Désigne qui tu jettes dehors avec toi.",
};

// ─────────────────────────── Hall ───────────────────────────
function PanneauHall({ p, assis, reglant, pantins, estMJ, op, estScene }: {
  p: Partie; assis: boolean; reglant: boolean; pantins: boolean; estMJ: boolean; op: (c: Record<string, unknown>) => Promise<boolean>; estScene: boolean;
}) {
  const o = p.options;
  const n = p.joueurs.length;
  const retirer = (r: RoleId) => op({ op: "regler", options: { retraits: o.retraits.includes(r) ? o.retraits.filter((x) => x !== r) : [...o.retraits, r] } });
  return (
    <div className="om-hall">
      <section className="om-bloc">
        <h2>{p.mode === "mj" ? "Partie menée par un MJ" : "Partie sans MJ"}</h2>
        <p className="om-doux">
          {p.mode === "mj"
            ? "Le Maître du jeu voit tout et raconte chaque aube. Prenez place, puis rejoignez le vocal."
            : "Le narrateur de la taverne enchaîne les phases tout seul. Prenez place, puis rejoignez le vocal."}
        </p>
        {!estScene && !estMJ && (
          assis
            ? <button type="button" className="om-bouton" onClick={() => op({ op: "quitter" })}>Quitter la table</button>
            : <button type="button" className="om-bouton or" onClick={() => op({ op: "rejoindre" })}>Prendre place</button>
        )}
      </section>

      {p.composition && (
        <section className="om-bloc">
          <h3>Dans la salle ce soir</h3>
          <div className="om-compo">
            {ORDRE_ROLES.filter((r) => p.composition!.includes(r)).map((r) => {
              const k = p.composition!.filter((x) => x === r).length;
              return (
                <span key={r} className="om-compo-role" data-camp={ROLES[r].camp}>
                  <Embleme role={r} taille={26} /> {ROLES[r].court}{k > 1 ? ` ×${k}` : ""}
                </span>
              );
            })}
          </div>
        </section>
      )}

      {reglant && (
        <section className="om-bloc">
          <h3>Réglages de l'hôte</h3>
          <div className="om-reglages">
            {([["nuit", "Nuit", 20, 120], ["debat", "Débat", 45, 600], ["conseil", "Conseil", 20, 180]] as const).map(([k, l, a, b]) => (
              <label key={k} className="om-curseur-reglage">
                <span>{l} <strong>{o[k] >= 60 ? `${Math.floor(o[k] / 60)} min ${o[k] % 60 ? `${o[k] % 60} s` : ""}` : `${o[k]} s`}</strong></span>
                <input type="range" min={a} max={b} step={5} defaultValue={o[k]}
                  onPointerUp={(e) => op({ op: "regler", options: { [k]: Number((e.target as HTMLInputElement).value) } })}
                  onKeyUp={(e) => op({ op: "regler", options: { [k]: Number((e.target as HTMLInputElement).value) } })} />
              </label>
            ))}
            <label className="om-case">
              <input type="checkbox" checked={o.evenements} onChange={(e) => op({ op: "regler", options: { evenements: e.target.checked } })} />
              Cartes Événement et Âmes de l'âtre
            </label>
          </div>
          <p className="om-doux petit">Rôles en jeu (clique pour retirer ou remettre) :</p>
          <div className="om-compo">
            {RETIRABLES.map((r) => (
              <button type="button" key={r} className={`om-compo-role bouton${o.retraits.includes(r) ? " retire" : ""}`} data-camp={ROLES[r].camp} onClick={() => retirer(r)} aria-pressed={!o.retraits.includes(r)}>
                <Embleme role={r} taille={22} /> {ROLES[r].court}
              </button>
            ))}
          </div>
          {pantins && (
            <div className="om-rangee">
              <button type="button" className="om-bouton petit" onClick={() => op({ op: "pantin", nombre: 1 })}>+ 1 pantin</button>
              <button type="button" className="om-bouton petit" onClick={() => op({ op: "pantin", nombre: 5 })}>+ 5 pantins</button>
              <span className="om-doux petit">Pantins : joueurs fictifs pour tester seul.</span>
            </div>
          )}
          <button type="button" className="om-bouton or large" disabled={n < 6} onClick={() => op({ op: "lancer" })}>
            {n < 6 ? `Lancer (${n}/6 convives)` : `Lancer la partie · ${n} convives`}
          </button>
        </section>
      )}
    </div>
  );
}

// ─────────────────────────── Actions de phase ───────────────────────────
function PanneauAction({ p, moi, choix, selection, confirmer, op, convertir, setConvertir, bruit }: {
  p: Partie; moi: Joueur | null; choix: { genre: string; max: number } | null; selection: string[];
  confirmer: () => void; op: (c: Record<string, unknown>) => Promise<boolean>;
  convertir: boolean; setConvertir: (v: boolean) => void; bruit: (b: Bruitage) => void;
}) {
  const perso = p.perso;
  const nom = (u?: string | null) => NOM_JOUEUR(p, u);
  const phase = p.phase;

  // Âmes de l'âtre : les morts choisissent la carte de demain
  if (moi && !moi.vivant && p.ames && (phase === "nuit" || phase === "alchimie")) {
    return (
      <section className="om-bloc om-ames">
        <h2>Les Âmes de l'âtre</h2>
        <p className="om-doux">Depuis les cendres, choisis l'Événement qui pèsera sur demain.</p>
        <div className="om-ames-cartes">
          {p.ames.cartes.map((c) => (
            <CarteEvenement key={c} carte={c} compte={p.ames!.compte[c] ?? 0} choisie={p.ames!.mon_vote === c}
              onChoisir={() => { bruit("papier"); op({ op: "ames", carte: c }); }} />
          ))}
        </div>
      </section>
    );
  }
  if (!perso || !moi) {
    return (
      <section className="om-bloc">
        <h2>{PHASES[phase].titre}</h2>
        <p className="om-doux">{p.est_mj ? "Tout se pilote depuis la console du MJ." : "Tu regardes la partie depuis le bord de la salle."}</p>
      </section>
    );
  }
  if (!moi.vivant) {
    return (
      <section className="om-bloc">
        <h2>Tu hantes la taverne</h2>
        <p className="om-doux">Reste muet en vocal : les morts ne parlent pas. La nuit, tu choisiras l'Événement avec les autres Âmes.</p>
      </section>
    );
  }
  const r = perso.role;
  const act = perso.action;

  if (phase === "distribution") return <section className="om-bloc"><h2>Découvre ton rôle</h2><p className="om-doux">Maintiens ta carte pour la lire. Personne d'autre ne la voit.</p></section>;

  if (phase === "nuit") {
    if (r === "cultiste" || r === "voix") {
      const monVote = perso.votes_ombres?.[moi.uid];
      return (
        <section className="om-bloc om-action-nuit ombres">
          <h2>La chasse</h2>
          <p>{monVote ? <>Ta proie : <strong>{nom(monVote)}</strong>. Tu peux encore changer.</> : "Désigne une proie sur la table."}</p>
          {r === "voix" && (
            <label className="om-case">
              <input type="checkbox" checked={convertir} disabled={perso.memo?.utilisee}
                onChange={(e) => { setConvertir(e.target.checked); if (monVote) op({ op: "agir", vote: monVote, convertir: e.target.checked }); }} />
              {perso.memo?.utilisee ? "Ta Voix a déjà servi." : "Convertir la proie au lieu de la tuer (une fois)"}
            </label>
          )}
          <button type="button" className="om-lien" onClick={() => op({ op: "agir", vote: "" })}>Ne désigner personne</button>
        </section>
      );
    }
    if (choix?.genre === "agir") {
      const verbe = { inquisiteur: "Sonder", paladin: "Protéger", tavernier: "Servir une tournée à", barde: "Enchanter" }[r as string] || "Choisir";
      return (
        <section className="om-bloc om-action-nuit">
          <h2>{ROLES[r].nom}</h2>
          <p className="om-doux">{ROLES[r].pouvoir}</p>
          {act?.cibles && !selection.length && <p>Choix scellé : <strong>{act.cibles.map(nom).join(" et ")}</strong>. Tu peux encore changer.</p>}
          {act?.passe && !selection.length && <p>Tu as choisi de dormir cette nuit.</p>}
          <div className="om-rangee">
            <button type="button" className="om-bouton or" disabled={!selection.length} onClick={confirmer}>
              {selection.length ? `${verbe} ${selection.map(nom).join(" et ")}` : `${verbe}…`}
            </button>
            <button type="button" className="om-lien" onClick={() => op({ op: "agir", passer: true })}>Dormir</button>
          </div>
        </section>
      );
    }
    return (
      <section className="om-bloc om-dodo">
        <h2>Tu dors</h2>
        <p className="om-doux">Ferme les yeux et coupe ton micro : les Ombres rôdent. {p.nuit_publique ? `${p.nuit_publique.eveilles} âme${p.nuit_publique.eveilles > 1 ? "s" : ""} s'agite${p.nuit_publique.eveilles > 1 ? "nt" : ""} dans le noir…` : ""}</p>
      </section>
    );
  }

  if (phase === "alchimie") {
    if (r === "alchimiste" && perso.alchimie) {
      const al = perso.alchimie;
      if (al.fait) return <section className="om-bloc"><h2>Tes fioles sont rangées</h2><p className="om-doux">{al.vie ? `Tu as sauvé ${nom(al.vie)}. ` : ""}{al.mort ? `Tu as empoisonné ${nom(al.mort)}.` : ""}</p></section>;
      return (
        <section className="om-bloc om-action-nuit alchimie">
          <h2>L'Alchimiste veille</h2>
          {al.brouillard ? <p>Le brouillard des marais te cache la victime cette nuit.</p>
            : al.cibles.length ? <p>Les Ombres s'apprêtent à frapper <strong>{al.cibles.map(nom).join(" et ")}</strong>.</p>
              : <p>Les Ombres n'ont désigné personne.</p>}
          <div className="om-fioles">
            {perso.memo?.fiole_vie && al.cibles.map((c) => (
              <button key={c} type="button" className="om-bouton vie" onClick={() => { bruit("fiole"); op({ op: "agir", vie: c, mort: selection[0] || "" }); }}>
                Fiole de vie sur {nom(c)}{selection[0] ? ` + mort sur ${nom(selection[0])}` : ""}
              </button>
            ))}
            {perso.memo?.fiole_mort && (
              <button type="button" className="om-bouton mort" disabled={!selection.length} onClick={confirmer}>
                {selection.length ? `Fiole de mort sur ${nom(selection[0])}` : "Fiole de mort : choisis sa cible"}
              </button>
            )}
            <button type="button" className="om-lien" onClick={() => op({ op: "agir", vie: "", mort: "" })}>Ne rien verser</button>
          </div>
          <p className="om-doux petit">Fiole de vie : {perso.memo?.fiole_vie ? "pleine" : "vide"} · fiole de mort : {perso.memo?.fiole_mort ? "pleine" : "vide"}</p>
        </section>
      );
    }
    return <section className="om-bloc om-dodo"><h2>Tu dors</h2><p className="om-doux">Quelque part, une fiole tinte…</p></section>;
  }

  if (phase === "aube") return <section className="om-bloc"><h2>L'aube</h2><p className="om-doux">{p.aube?.proclamee ? "Écoutez le récit de la nuit…" : p.mode === "mj" ? "Le Maître du jeu prend la parole…" : "Le narrateur rassemble ses souvenirs…"}</p></section>;

  if (phase === "videur") {
    if (p.videur === moi.uid)
      return (
        <section className="om-bloc om-action-nuit videur">
          <h2>Dernier coup du Videur</h2>
          <p>Tu tombes… mais pas seul. Désigne qui tu emportes.</p>
          <button type="button" className="om-bouton mort" disabled={!selection.length} onClick={confirmer}>
            {selection.length ? `Jeter ${nom(selection[0])} dehors` : "Choisis sur la table"}
          </button>
        </section>
      );
    return <section className="om-bloc"><h2>Le Videur se relève</h2><p className="om-doux">{nom(p.videur)} cherche qui emporter dans sa chute…</p></section>;
  }

  if (phase === "debat") {
    const vivants = p.joueurs.filter((j) => j.vivant).length;
    return (
      <section className="om-bloc">
        <h2>Le débat</h2>
        <p className="om-doux">Tout se joue en vocal : accusez, défendez-vous, mentez. Quand la majorité est prête, le Conseil s'ouvre.</p>
        <button type="button" className="om-bouton" onClick={() => op({ op: "pret" })}>Passer au vote ({p.pret_vote}/{Math.floor(vivants / 2) + 1})</button>
      </section>
    );
  }

  if (phase === "conseil") {
    if (p.muet === moi.uid) return <section className="om-bloc"><h2>Pas de voix aujourd'hui</h2><p className="om-doux">La bière frelatée t'a coupé le sifflet.</p></section>;
    return (
      <section className="om-bloc om-conseil">
        <h2>Le Conseil</h2>
        <p>{perso.mon_vote ? <>Ta voix va à <strong>{nom(perso.mon_vote)}</strong>.</> : perso.mon_vote === "" ? "Tu votes blanc." : "Clique sur ton suspect."}</p>
        {p.votes?.secret && <p className="om-doux">Bulletins cachetés : les voix restent secrètes jusqu'au verdict ({p.votes.exprimes} bulletin{p.votes.exprimes > 1 ? "s" : ""}).</p>}
        <button type="button" className="om-lien" onClick={() => op({ op: "voter", cible: "" })}>Voter blanc</button>
      </section>
    );
  }

  if (phase === "verdict") {
    const v = p.verdict;
    return <section className="om-bloc"><h2>Le verdict</h2><p>{v?.chasse ? `${nom(v.chasse)} est jeté hors de la taverne (${v.voix} voix).` : v?.egalite ? "Égalité : personne n'est chassé." : "Le Conseil n'a désigné personne."}</p></section>;
  }
  return null;
}

// ─────────────────────────── Arbitrage (sans MJ) ───────────────────────────
function Arbitrage({ p, op }: { p: Partie; op: (c: Record<string, unknown>) => Promise<boolean> }) {
  return (
    <div className="om-arbitrage">
      <span>Arbitre</span>
      {p.pause != null
        ? <button type="button" className="om-bouton petit" onClick={() => op({ op: "reprendre" })}>Reprendre</button>
        : <button type="button" className="om-bouton petit" onClick={() => op({ op: "pause" })}>Pause</button>}
      <button type="button" className="om-bouton petit" onClick={() => op({ op: "prolonger", secondes: 30 })}>+30 s</button>
      <button type="button" className="om-bouton petit" onClick={() => op({ op: "passer" })}>Passer</button>
      <button type="button" className="om-lien" onClick={() => { if (confirm("Interrompre la partie pour tout le monde ?")) op({ op: "annuler" }); }}>Interrompre</button>
    </div>
  );
}

// ─────────────────────────── Console du MJ ───────────────────────────
function ConsoleMJ({ p, op, aubeMJ, setAubeMJ, lienScene, copie, copier }: {
  p: Partie; op: (c: Record<string, unknown>) => Promise<boolean>; aubeMJ: string | null; setAubeMJ: (v: string | null) => void;
  lienScene: string; copie: boolean; copier: () => void;
}) {
  const s = p.secrets;
  const nom = (u?: string | null) => NOM_JOUEUR(p, u);
  const roleDe = (u: string) => p.joueurs.find((j) => j.uid === u)?.role;
  const enCours = !["hall", "fin"].includes(p.phase);
  return (
    <div className="om-console">
      {enCours && <Arbitrage p={p} op={op} />}
      {p.phase === "aube" && s && !p.aube?.proclamee && (
        <section className="om-bloc om-aube-mj">
          <h3>Proclamer l'aube</h3>
          <p className="om-doux petit">
            Morts de la nuit : {s.aube_morts.length ? s.aube_morts.map((m) => `${nom(m.uid)} (${CAUSES[m.cause]})`).join(", ") : "personne"}
            {p.aube?.carte ? ` · carte du jour : ${CARTES[p.aube.carte].nom}` : ""}
          </p>
          <textarea rows={5} value={aubeMJ ?? s.aube_brouillon} placeholder="Le narrateur prépare un brouillon…"
            onChange={(e) => setAubeMJ(e.target.value)} />
          <button type="button" className="om-bouton or" onClick={async () => { if (await op({ op: "proclamer", texte: aubeMJ ?? s.aube_brouillon })) setAubeMJ(null); }}>
            Proclamer et révéler les morts
          </button>
        </section>
      )}
      {s && (p.phase === "nuit" || p.phase === "alchimie") && (
        <section className="om-bloc">
          <h3>Cette nuit</h3>
          <ul className="om-liste-mj">
            {Object.entries(s.votes_ombres).map(([u, c]) => <li key={`o${u}`} className="ombres">{nom(u)} veut dévorer <strong>{c ? nom(c) : "personne"}</strong></li>)}
            {Object.entries(s.actions).map(([u, a]) => {
              const r = roleDe(u);
              if (!r || r === "cultiste") return null;
              const quoi = a.passe ? "dort" : r === "voix" ? (a.convertir ? "veut convertir" : "chasse sans convertir") : `→ ${(a.cibles || []).map(nom).join(", ")}`;
              return <li key={`a${u}`}><Embleme role={r} taille={16} /> {nom(u)} ({ROLES[r].court}) {quoi}</li>;
            })}
            {s.cibles.length > 0 && <li>Cible retenue : <strong>{s.cibles.map(nom).join(", ")}</strong></li>}
            {s.bloque && <li>Servi par le Tavernier : {nom(s.bloque)}</li>}
            {s.alchimie?.fait && <li>Alchimiste : {s.alchimie.vie ? `sauve ${nom(s.alchimie.vie)}` : "ne sauve personne"}{s.alchimie.mort ? `, empoisonne ${nom(s.alchimie.mort)}` : ""}</li>}
          </ul>
          <p className="om-doux petit">
            Fiole de vie {s.memo.fiole_vie ? "pleine" : "vide"} · fiole de mort {s.memo.fiole_mort ? "pleine" : "vide"} · Voix {s.memo.voix_utilisee ? "utilisée" : "intacte"}
          </p>
        </section>
      )}
      {enCours && (
        <section className="om-bloc">
          <h3>La tablée</h3>
          <ul className="om-liste-mj">
            {p.joueurs.map((j) => (
              <li key={j.uid} className={j.vivant ? "" : "mort"}>
                {j.role && <Embleme role={j.role} taille={18} />} <strong>{j.nom}</strong> — {j.role ? ROLES[j.role].court : "?"}
                {j.enchante ? " · enchanté" : ""}
                {j.vivant && (
                  <button type="button" className="om-lien" onClick={() => { if (confirm(`Exclure ${j.nom} de la partie ?`)) op({ op: "exclure", uid: j.uid }); }}>exclure</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {p.phase === "hall" && <section className="om-bloc"><p className="om-doux petit">Tu mènes la partie : tu ne joues pas, tu verras tous les rôles une fois les cartes distribuées.</p></section>}
      {lienScene && (
        <section className="om-bloc">
          <h3>Vue de scène</h3>
          <p className="om-doux petit">Lien public, sans connexion, sans aucun secret : pour ta capture de stream ou un écran de salle.</p>
          <div className="om-rangee">
            <button type="button" className="om-bouton petit" onClick={copier}>{copie ? "Copié !" : "Copier le lien"}</button>
            <button type="button" className="om-lien" onClick={() => op({ op: "scene_cle" })}>Changer la clé</button>
          </div>
        </section>
      )}
    </div>
  );
}

// ─────────────────────────── Journal ───────────────────────────
function Journal({ p, filtre, setFiltre }: { p: Partie | null; filtre: string; setFiltre: (f: "tout" | "recit" | "votes" | "secrets") => void }) {
  const fin = useRef<HTMLDivElement>(null);
  const entrees = (p?.journal ?? []).filter((e) =>
    filtre === "tout" ? true : filtre === "recit" ? ["recit", "mort", "testament", "evenement", "fin"].includes(e.type)
      : filtre === "votes" ? e.type === "vote" : e.type === "secret");
  const dernierRecit = [...entrees].reverse().find((e) => e.type === "recit" && e.aube)?.id;
  useEffect(() => { fin.current?.scrollIntoView({ block: "end" }); }, [entrees.length]);
  const aSecrets = p?.journal.some((e) => e.type === "secret");
  return (
    <div className="om-journal">
      <div className="om-filtres">
        {([["tout", "Tout"], ["recit", "Récit"], ["votes", "Votes"], ...(aSecrets ? [["secrets", "Secrets"]] : [])] as [string, string][]).map(([k, l]) => (
          <button key={k} type="button" className={filtre === k ? "actif" : ""} onClick={() => setFiltre(k as "tout")}>{l}</button>
        ))}
      </div>
      <div className="om-entrees">
        {entrees.length === 0 && <p className="om-doux">Le journal de la taverne est encore vierge.</p>}
        {entrees.map((e: Entree) => (
          <p key={e.id} className={`om-entree om-entree-${e.type}`}>
            {e.type === "mort" && e.role && <Embleme role={e.role} taille={20} />}
            {e.type === "evenement" && <span className="om-puce-evt">✦</span>}
            {e.id === dernierRecit ? <Machine texte={e.texte} /> : e.texte}
          </p>
        ))}
        <div ref={fin} />
      </div>
    </div>
  );
}

// ─────────────────────────── Cinématiques ───────────────────────────
function Cinematique({ cine, p, fermer, op, peutRejouer }: {
  cine: Cine; p: Partie | null; fermer: () => void; op: (c: Record<string, unknown>) => Promise<boolean>; peutRejouer: boolean;
}) {
  if (cine.genre === "phase") {
    return (
      <div className={`om-cine om-cine-phase${cine.nuit ? " nuit" : ""}`} onClick={fermer} key={cine.cle}>
        <div className="om-cine-titre">{cine.titre}</div>
        <div className="om-cine-sous">{cine.sous}</div>
      </div>
    );
  }
  if (!p) return null;
  if (cine.genre === "morts") {
    const morts = (p.aube?.morts ?? []).map((u) => p.joueurs.find((j) => j.uid === u)).filter(Boolean) as Joueur[];
    return (
      <div className="om-cine om-cine-morts" onClick={fermer}>
        <div className="om-cine-titre">{morts.length ? (morts.length > 1 ? "Ils ne verront pas ce jour" : "Une chandelle s'est éteinte") : "Tout le monde est là"}</div>
        {p.aube?.texte && <p className="om-cine-recit"><Machine texte={p.aube.texte} vitesse={20} /></p>}
        <div className="om-cine-cartes">
          {morts.map((j, i) => (
            <div key={j.uid} className="om-cine-mort" style={{ animationDelay: `${0.6 + i * 0.5}s` }}>
              <CarteRole role={j.role} ouverte taille="m" detail={false} />
              <strong>{j.nom}</strong>
              <span>{CAUSES[j.mort?.cause || ""] || ""}</span>
              {j.testament && <em>« {j.testament} »</em>}
            </div>
          ))}
          {p.aube?.carte && (
            <div className="om-cine-mort" style={{ animationDelay: `${0.8 + morts.length * 0.5}s` }}>
              <CarteEvenement carte={p.aube.carte} />
              <span>Événement du jour</span>
            </div>
          )}
        </div>
        <span className="om-cine-fermer">Cliquer pour fermer</span>
      </div>
    );
  }
  if (cine.genre === "verdict") {
    const c = p.joueurs.find((j) => j.uid === p.verdict?.chasse);
    return (
      <div className="om-cine om-cine-morts" onClick={fermer}>
        <div className="om-cine-titre">{c ? `${c.nom} est chassé` : p.verdict?.egalite ? "Égalité au Conseil" : "Personne n'est chassé"}</div>
        {c && (
          <div className="om-cine-cartes">
            <div className="om-cine-mort" style={{ animationDelay: "0.5s" }}>
              <CarteRole role={c.role} ouverte taille="l" detail={false} />
              {c.testament && <em>« {c.testament} »</em>}
            </div>
          </div>
        )}
        <span className="om-cine-fermer">Cliquer pour fermer</span>
      </div>
    );
  }
  // fin
  const f = p.fin;
  if (!f) return null;
  const camp = f.vainqueur in CAMPS ? CAMPS[f.vainqueur as keyof typeof CAMPS] : null;
  const embleme: Record<string, RoleId | "dos"> = { taverne: "habitue", ombres: "cultiste", barde: "barde", ragequit: "ragequit" };
  return (
    <div className="om-cine om-cine-fin" style={{ ["--camp" as string]: camp?.couleur || "#d9b45a" }}>
      <div className="om-fin-embleme"><Embleme role={embleme[f.vainqueur] || "dos"} taille={130} /></div>
      <div className="om-cine-titre">{f.titre}</div>
      {f.raison && <p className="om-cine-sous">{f.raison}</p>}
      <div className="om-fin-grille">
        {p.joueurs.map((j, i) => (
          <div key={j.uid} className={`om-fin-joueur${f.gagnants.includes(j.uid) ? " gagnant" : ""}`} style={{ animationDelay: `${0.3 + i * 0.08}s` }}>
            <CarteRole role={j.role} ouverte taille="s" detail={false} />
            <strong>{j.nom}</strong>
            <span>{f.gagnants.includes(j.uid) ? "Victoire" : j.vivant ? "Survivant" : "Mort"}</span>
          </div>
        ))}
      </div>
      <div className="om-rangee centre">
        {peutRejouer && <button type="button" className="om-bouton or" onClick={() => { op({ op: "rejouer" }); fermer(); }}>Rejouer</button>}
        <button type="button" className="om-bouton" onClick={fermer}>Revoir la table</button>
      </div>
    </div>
  );
}

// ─────────────────────────── Règles ───────────────────────────
function Regles({ fermer }: { fermer: () => void }) {
  return (
    <div className="om-modale" role="dialog" aria-modal="true" aria-label="Règles" onClick={fermer}>
      <div className="om-modale-corps" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="om-modale-fermer" onClick={fermer} aria-label="Fermer">×</button>
        <h2>Les règles de la taverne</h2>
        <p>
          Des Ombres se sont glissées parmi les convives. <strong>La nuit</strong>, chacun use de son pouvoir en secret, sur cette page ;
          les Ombres désignent une victime. <strong>Le jour</strong>, on découvre les morts, on débat en vocal, puis le <strong>Conseil</strong> vote
          pour chasser un suspect. Un mort révèle sa carte et se tait.
        </p>
        <p>
          <strong>La Taverne</strong> gagne quand plus aucune Ombre ne vit. <strong>Les Ombres</strong> gagnent dès qu'elles sont aussi nombreuses
          que les autres vivants. Le <strong>Barde</strong> gagne seul si toute la salle est sous son charme ; le <strong>Ragequit</strong>, s'il se
          fait chasser le premier jour.
        </p>
        <p>
          <strong>Les Âmes de l'âtre</strong> : chaque nuit, les morts votent pour l'Événement qui sera tiré à l'aube et pèsera sur la journée
          et la nuit suivantes. Pense aussi à tes <strong>dernières volontés</strong> : une phrase lue à voix haute si tu tombes.
        </p>
        <h3>Les rôles</h3>
        <div className="om-regles-roles">
          {ORDRE_ROLES.map((r) => (
            <div key={r} className="om-regle-role" data-camp={ROLES[r].camp}>
              <Embleme role={r} taille={54} />
              <div>
                <strong>{ROLES[r].nom}</strong> <span className="om-camp-pastille">{CAMPS[ROLES[r].camp].nom}</span>
                <p>{ROLES[r].pouvoir}</p>
              </div>
            </div>
          ))}
        </div>
        <h3>Combien d'Ombres ?</h3>
        <p className="om-doux">
          6–7 convives : 1 Ombre · 8–10 : 2 · 11–13 : 3 · 14–16 : 4 (dont la Voix). Les rôles spéciaux arrivent avec le nombre :
          Inquisiteur et Alchimiste dès 6, Paladin à 7, Videur à 8, Ragequit à 9, Tavernier à 11, Barde à 12.
        </p>
        <h3>Les cartes Événement</h3>
        <div className="om-regles-cartes">
          {(Object.keys(CARTES) as CarteId[]).map((c) => <CarteEvenement key={c} carte={c} />)}
        </div>
      </div>
    </div>
  );
}
