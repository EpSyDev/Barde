"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PisteDes3D, definirPolice, type DeTire, type Faces } from "@/lib/des3d";

const TYPES: Faces[] = [4, 6, 8, 10, 12, 20, 100];
const MAX_MAIN = 12; // dés visibles à la fois sur la piste

type Resultat = {
  total: number;
  expr: string;
  nat: number | null;
  lignes: string[];
  des: DeTire[];
  raison: string;
  heure: string;
};

/** « **12**, ~~3~~ » (format des lignes du bot) → éléments lisibles. */
function Ligne({ texte }: { texte: string }) {
  const parts = texte.split(/(\*\*[^*]+\*\*|~~[^~]+~~|`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b>
        : p.startsWith("~~") ? <s key={i}>{p.slice(2, -2)}</s>
        : p.startsWith("`") ? <code key={i}>{p.slice(1, -1)}</code>
        : <span key={i}>{p}</span>
      )}
    </>
  );
}

function expression(main: Record<number, number>, mod: number): string {
  const des = TYPES.filter((f) => main[f] > 0).map((f) => `${main[f]}d${f}`);
  let e = des.join("+") || "1d20";
  if (mod) e += mod > 0 ? `+${mod}` : `${mod}`;
  return e;
}

export default function PisteDes() {
  const hote = useRef<HTMLDivElement>(null);
  const piste = useRef<PisteDes3D | null>(null);
  const [main, setMain] = useState<Record<number, number>>({});
  const [mod, setMod] = useState(0);
  const [raison, setRaison] = useState("");
  const [critique, setCritique] = useState(false);
  const [roule, setRoule] = useState(false);
  const [resultat, setResultat] = useState<Resultat | null>(null);
  const [histo, setHisto] = useState<Resultat[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    (async () => {
      // Les chiffres des dés sont peints avec Cinzel, comme le reste du panneau.
      const fam = getComputedStyle(document.documentElement).getPropertyValue("--font-title").trim();
      if (fam) {
        try {
          await document.fonts.load(`700 64px ${fam}`);
        } catch {
          /* police de secours */
        }
        definirPolice(fam);
      }
      if (vivant && hote.current) piste.current = new PisteDes3D(hote.current);
      if (process.env.NODE_ENV !== "production") (window as unknown as { __piste?: PisteDes3D }).__piste = piste.current ?? undefined;
    })();
    return () => {
      vivant = false;
      piste.current?.detruire();
      piste.current = null;
    };
  }, []);

  const nbDes = Object.values(main).reduce((a, b) => a + b, 0);
  const ajouter = (f: Faces) =>
    nbDes < MAX_MAIN && setMain((m) => ({ ...m, [f]: (m[f] || 0) + 1 }));
  const retirer = (f: Faces) => setMain((m) => ({ ...m, [f]: Math.max(0, (m[f] || 0) - 1) }));

  const lancer = useCallback(async () => {
    if (roule || !piste.current) return;
    setRoule(true);
    setErreur(null);
    const expr = expression(main, mod);
    try {
      const res = await fetch("/api/table/jet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expr, raison, critique }),
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setResultat(null);
      await piste.current.lancer(d.des, d.nat);
      const r: Resultat = {
        ...d,
        raison,
        heure: new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
      };
      setResultat(r);
      setHisto((h) => [r, ...h].slice(0, 12));
    } catch {
      setErreur("Le lancer n'a pas pu partir (La Fripouille est-elle en ligne ?).");
    } finally {
      setRoule(false);
    }
  }, [roule, main, mod, raison, critique]);

  // Entrée = lancer (hors champ texte) ; Échap = vider la main.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") {
        if (e.key === "Enter") lancer();
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        lancer();
      } else if (e.key === "Escape") setMain({});
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [lancer]);

  return (
    <div className="piste">
      <header className="piste-tete">
        <a href="/?s=des" className="piste-retour">← Panneau</a>
        <h1>Piste de dés</h1>
        <span className="piste-sous">La Taverne du Gaming · tirage garanti par La Fripouille</span>
      </header>

      <div className="piste-corps">
        <div className="piste-scene" ref={hote}>
          {resultat && !roule && (
            <div className={`piste-total ${resultat.nat === 20 ? "crit" : resultat.nat === 1 ? "fumble" : ""}`}>
              <span className="piste-total-val">{resultat.total}</span>
              {resultat.nat === 20 && <span className="piste-total-msg">Réussite critique !</span>}
              {resultat.nat === 1 && <span className="piste-total-msg">Échec critique…</span>}
            </div>
          )}
        </div>

        <aside className="piste-panneau">
          <h2>Dernier jet</h2>
          {resultat ? (
            <div className="piste-detail">
              {resultat.raison && <div className="piste-raison">{resultat.raison}</div>}
              <div className="piste-expr">{resultat.expr}</div>
              {resultat.lignes.map((l, i) => (
                <div key={i} className="piste-ligne">
                  <Ligne texte={l} />
                </div>
              ))}
              <div className="piste-somme">
                Total <b>{resultat.total}</b>
              </div>
            </div>
          ) : (
            <p className="piste-vide">Choisis tes dés en bas, puis lance (ou appuie sur Entrée).</p>
          )}

          {histo.length > 1 && (
            <>
              <h2>Historique</h2>
              <ol className="piste-histo">
                {histo.slice(1).map((h, i) => (
                  <li key={i}>
                    <span>{h.heure}</span>
                    <span className="piste-histo-expr">{h.raison || h.expr}</span>
                    <b className={h.nat === 20 ? "crit" : h.nat === 1 ? "fumble" : ""}>{h.total}</b>
                  </li>
                ))}
              </ol>
            </>
          )}
        </aside>
      </div>

      <footer className="piste-barre">
        <div className="piste-des">
          {TYPES.map((f) => (
            <button
              key={f}
              className={`piste-de de-${f}`}
              onClick={() => ajouter(f)}
              onContextMenu={(e) => {
                e.preventDefault();
                retirer(f);
              }}
              title={`Ajouter un d${f} (clic droit : en retirer un)`}
              disabled={roule}
            >
              <span>d{f}</span>
              {main[f] > 0 && <em>{main[f]}</em>}
            </button>
          ))}
        </div>

        <div className="piste-reglages">
          <div className="piste-mod" title="Modificateur ajouté au total">
            <button onClick={() => setMod((m) => m - 1)} disabled={roule}>−</button>
            <span>{mod >= 0 ? `+${mod}` : mod}</span>
            <button onClick={() => setMod((m) => m + 1)} disabled={roule}>+</button>
          </div>
          <input
            className="piste-raison-champ"
            value={raison}
            onChange={(e) => setRaison(e.target.value)}
            placeholder="Pour quoi ? (Attaque, Perception…)"
            maxLength={60}
          />
          <label className="piste-crit" title="Coup critique : les dés de dégâts sont doublés">
            <input type="checkbox" checked={critique} onChange={(e) => setCritique(e.target.checked)} />
            Critique
          </label>
        </div>

        <div className="piste-action">
          <span className="piste-formule">{expression(main, mod)}</span>
          <button className="piste-vider" onClick={() => { setMain({}); setMod(0); }} disabled={roule}>
            Vider
          </button>
          <button className="piste-lancer" onClick={lancer} disabled={roule}>
            {roule ? "Ça roule…" : "Lancer"}
          </button>
        </div>
        {erreur && <p className="piste-erreur">{erreur}</p>}
      </footer>
    </div>
  );
}
