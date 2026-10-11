"use client";

// La table ronde vue de dessus : sièges en cercle, chandelle centrale qui sert de
// sablier (anneau de temps), fils de vote tendus d'un siège à l'autre.

import { CAMPS, ROLES, initiales, teinte, type Joueur } from "@/lib/ombres";
import { Embleme } from "./Emblemes";

export type Fil = { de: string; vers: string; genre: "conseil" | "ombres" | "inquisiteur" | "paladin" | "tavernier" | "barde" | "alchimiste" };
export type Marque = "protege" | "cible" | "poison" | "servi" | "enchante" | "muet" | "pret";

type Props = {
  joueurs: Joueur[];
  moi: string | null;
  nuit: boolean;
  selection: string[];
  selectionnables: Set<string> | null;
  onSiege?: (uid: string) => void;
  onRetirer?: (uid: string) => void;
  fils: Fil[];
  compte: Record<string, number>;
  marques: Record<string, Marque[]>;
  reste: number | null;
  total: number | null;
  enPause: boolean;
  centre: string;
  sous: string;
  surbrillance?: string | null;
  places?: number;              // hall : chaises vides à dessiner
};

const COULEUR_FIL: Record<Fil["genre"], string> = {
  conseil: "#e0533f", ombres: "#a77bff", inquisiteur: "#6fa8ff", paladin: "#dfe6ee",
  tavernier: "#f0b54a", barde: "#5fbf86", alchimiste: "#7ee0a0",
};

function position(i: number, n: number, r = 41) {
  const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
  return { x: 50 + r * Math.cos(a), y: 50 + r * Math.sin(a) };
}

function Pictogramme({ m }: { m: Marque }) {
  const d: Record<Marque, string> = {
    protege: "M12 2 20 5v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5z",
    cible: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 5a4 4 0 1 1 0 8 4 4 0 0 1 0-8z",
    poison: "M12 2c3 5 6 8 6 12a6 6 0 0 1-12 0c0-4 3-7 6-12z",
    servi: "M5 4h11v13a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3zm11 3h2a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2",
    enchante: "M9 18a3 3 0 1 1-2-2.8V4l11-2v12a3 3 0 1 1-2-2.8V6l-7 1.3z",
    muet: "M5 4h11v13a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3zM3 21 21 3",
    pret: "M5 12l5 5L20 7",
  };
  const titres: Record<Marque, string> = {
    protege: "Protégé par le Paladin", cible: "Cible des Ombres", poison: "Empoisonné", servi: "Servi par le Tavernier",
    enchante: "Enchanté par le Barde", muet: "Bière frelatée : pas de voix", pret: "Prêt à voter",
  };
  return (
    <span className={`om-marque om-marque-${m}`} title={titres[m]}>
      <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
        <path d={d[m]} fill={m === "servi" || m === "muet" || m === "pret" ? "none" : "currentColor"} stroke="currentColor" strokeWidth={m === "servi" || m === "muet" || m === "pret" ? 2.4 : 0} strokeLinecap="round" />
      </svg>
    </span>
  );
}

function Chandelle({ nuit }: { nuit: boolean }) {
  return (
    <svg viewBox="0 0 60 110" className="om-chandelle" aria-hidden="true">
      <defs>
        <radialGradient id="om-halo" cx="0.5" cy="0.32" r="0.5">
          <stop offset="0" stopColor={nuit ? "#cdb6ff" : "#ffe7a3"} stopOpacity="0.85" />
          <stop offset="1" stopColor={nuit ? "#7b4fd0" : "#ff9a3c"} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="om-cire" x1="0" x2="1">
          <stop offset="0" stopColor="#c9b48a" /><stop offset="0.45" stopColor="#f3e6c6" /><stop offset="1" stopColor="#a8936b" />
        </linearGradient>
        <radialGradient id="om-flamme" cx="0.5" cy="0.7" r="0.6">
          <stop offset="0" stopColor="#fffbe6" /><stop offset="0.35" stopColor={nuit ? "#d9c6ff" : "#ffd36b"} />
          <stop offset="1" stopColor={nuit ? "#6a3fd0" : "#ff7a1f"} stopOpacity="0.2" />
        </radialGradient>
      </defs>
      <circle cx="30" cy="30" r="30" fill="url(#om-halo)" className="om-halo" />
      <path d="M17 52h26v44q0 5-13 5T17 96z" fill="url(#om-cire)" />
      <path d="M17 52q4 6 2 14q-1 4 2 6M38 52q-2 9 1 13" stroke="#e9dcbc" strokeWidth="3" fill="none" strokeLinecap="round" />
      <ellipse cx="30" cy="52" rx="13" ry="3.4" fill="#f6ecd0" />
      <path d="M30 51v-6" stroke="#2a1806" strokeWidth="1.6" />
      <path className="om-flamme" d="M30 18q9 12 6 22q-2 6-6 6t-6-6q-3-10 6-22z" fill="url(#om-flamme)" />
      <ellipse cx="30" cy="104" rx="20" ry="4" fill="#000" opacity="0.35" />
    </svg>
  );
}

export default function Table(p: Props) {
  const n = Math.max(p.joueurs.length + (p.places ?? 0), 6);
  const frac = p.reste !== null && p.total ? Math.max(0, Math.min(1, p.reste / p.total)) : null;
  const R_ANNEAU = 15.5;
  const circ = 2 * Math.PI * R_ANNEAU;
  const urgent = p.reste !== null && p.reste <= 10 && !p.enPause;
  const pos = new Map(p.joueurs.map((j, i) => [j.uid, position(i, n)]));
  const mm = Math.floor((p.reste ?? 0) / 60), ss = Math.floor((p.reste ?? 0) % 60);

  return (
    <div className={`om-table${p.nuit ? " nuit" : ""}`} style={{ ["--siege" as string]: n > 12 ? "8.4%" : n > 9 ? "9.6%" : "11%" }}>
      <div className="om-plateau">
        <div className="om-plateau-bois" />
        <div className="om-plateau-cerclage" />
      </div>

      <svg className="om-fils" viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          {Object.entries(COULEUR_FIL).map(([g, c]) => (
            <marker key={g} id={`om-pointe-${g}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" fill={c} />
            </marker>
          ))}
        </defs>
        {p.fils.map((f, i) => {
          const a = pos.get(f.de), b = pos.get(f.vers);
          if (!a || !b || f.de === f.vers) return null;
          // la pointe s'arrête au bord du médaillon
          const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
          const bx = b.x - (dx / L) * 5.2, by = b.y - (dy / L) * 5.2;
          const ax = a.x + (dx / L) * 4.5, ay = a.y + (dy / L) * 4.5;
          const cx = (ax + bx) / 2 * 0.62 + 50 * 0.38, cy = (ay + by) / 2 * 0.62 + 50 * 0.38;
          return (
            <path key={`${f.de}-${f.vers}-${i}`} d={`M${ax} ${ay}Q${cx} ${cy} ${bx} ${by}`}
              className={`om-fil om-fil-${f.genre}`} stroke={COULEUR_FIL[f.genre]} markerEnd={`url(#om-pointe-${f.genre})`} />
          );
        })}
      </svg>

      <div className="om-centre">
        <svg viewBox="0 0 40 40" className={`om-anneau${urgent ? " urgent" : ""}`} aria-hidden="true">
          <circle cx="20" cy="20" r={R_ANNEAU} className="om-anneau-fond" />
          {frac !== null && (
            <circle cx="20" cy="20" r={R_ANNEAU} className="om-anneau-temps"
              strokeDasharray={circ} strokeDashoffset={circ * (1 - frac)} transform="rotate(-90 20 20)" />
          )}
        </svg>
        <Chandelle nuit={p.nuit} />
        <div className="om-centre-texte">
          {p.reste !== null && (
            <div className={`om-chrono${urgent ? " urgent" : ""}`}>
              {p.enPause ? "En pause" : `${mm}:${String(ss).padStart(2, "0")}`}
            </div>
          )}
          <div className="om-centre-titre">{p.centre}</div>
          {p.sous && <div className="om-centre-sous">{p.sous}</div>}
        </div>
      </div>

      {Array.from({ length: p.places ?? 0 }, (_, k) => {
        const { x, y } = position(p.joueurs.length + k, n);
        return <div key={`vide-${k}`} className="om-siege vide" style={{ left: `${x}%`, top: `${y}%` }}><span className="om-medaillon" /></div>;
      })}

      {p.joueurs.map((j) => {
        const { x, y } = pos.get(j.uid)!;
        const choisi = p.selection.includes(j.uid);
        const possible = p.selectionnables?.has(j.uid) ?? false;
        const role = j.role ? ROLES[j.role] : null;
        const camp = j.camp ? CAMPS[j.camp] : null;
        const ombreAlliee = j.camp === "ombres" && j.vivant && !!j.role && j.uid !== p.moi;
        const classes = ["om-siege", j.vivant ? "vivant" : "mort", choisi && "choisi", possible && "possible",
          j.uid === p.moi && "moi", ombreAlliee && "allie", p.surbrillance === j.uid && "surbrillance"].filter(Boolean).join(" ");
        const Bal = possible && p.onSiege ? "button" : "div";
        return (
          <Bal key={j.uid} type={Bal === "button" ? "button" : undefined} className={classes}
            style={{ left: `${x}%`, top: `${y}%`, ["--camp" as string]: camp?.couleur }}
            onClick={possible && p.onSiege ? () => p.onSiege!(j.uid) : undefined}
            aria-label={possible ? `Choisir ${j.nom}` : j.nom}>
            <span className="om-medaillon" style={{ background: j.avatar ? undefined : teinte(j.uid) }}>
              {j.avatar ? <img src={j.avatar} alt="" draggable={false} /> : <span className="om-initiales">{initiales(j.nom)}</span>}
              {!j.vivant && <span className="om-voile-mort" />}
            </span>
            <span className={`om-bougie-siege${j.vivant ? "" : " eteinte"}`} aria-hidden="true" />
            {(p.compte[j.uid] ?? 0) > 0 && <span className="om-sceau-voix">{p.compte[j.uid]}</span>}
            <span className="om-plaque">
              {j.uid === p.moi && <em>Toi · </em>}
              {j.nom}
              {j.pantin && <small> (pantin)</small>}
            </span>
            {role && (j.uid !== p.moi || !j.vivant) && (
              <span className="om-role-siege" title={role.nom}>
                <Embleme role={j.role!} taille={18} /> {role.court}
              </span>
            )}
            {!!p.marques[j.uid]?.length && (
              <span className="om-marques">{p.marques[j.uid].map((m) => <Pictogramme key={m} m={m} />)}</span>
            )}
            {p.onRetirer && j.uid !== p.moi && (
              <button type="button" className="om-retirer" onClick={(e) => { e.stopPropagation(); p.onRetirer!(j.uid); }} aria-label={`Retirer ${j.nom}`}>×</button>
            )}
          </Bal>
        );
      })}
    </div>
  );
}
