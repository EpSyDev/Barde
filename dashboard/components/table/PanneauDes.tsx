"use client";

// Onglet « Dés » de la table : mêmes possibilités que le panneau Discord.
// Un clic = un dé · jet libre (1d8+2d6+3, 4d6kh3, 2d6r2, d%) · raison · critique (dégâts
// doublés) · jet secret du MJ + « Révéler » · « Relancer » sur ses propres jets.

import { useState } from "react";
import type { Jet, Moi, Op } from "./types";
import { estMJ } from "./types";

const DES = [4, 6, 8, 10, 12, 20, 100];

export function Ligne({ texte }: { texte: string }) {
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

export default function PanneauDes({ fil, moi, op }: { fil: Jet[]; moi: Moi | null; op: Op }) {
  const mj = estMJ(moi);
  const [expr, setExpr] = useState("1d20");
  const [raison, setRaison] = useState("");
  const [critique, setCritique] = useState(false);
  const [secret, setSecret] = useState(false);

  const lancer = async (e?: string) => {
    const d = await op({ op: "jet", expr: (e ?? expr).replace(/\s/g, "") || "1d20", raison, critique, secret: mj && secret });
    if (d) setRaison("");
  };
  // Ajoute un dé à l'expression : « 1d20+5 » + d6 → « 1d20+5+1d6 », ou incrémente « 1d6 » → « 2d6 ».
  const ajouter = (f: number) =>
    setExpr((x) => {
      const re = new RegExp(`(^|\\+)(\\d*)d${f}(?![0-9])`);
      const m = x.match(re);
      if (m) return x.replace(re, `${m[1]}${(Number(m[2] || 1) || 1) + 1}d${f}`);
      return x && x !== "0" ? `${x}+1d${f}` : `1d${f}`;
    });

  return (
    <div className="plateau-section">
      <h2>Un clic = un dé</h2>
      <div className="plateau-desrapides">
        {DES.map((f) => (
          <button
            key={f}
            className={`piste-de de-${f}`}
            onClick={() => lancer(`1d${f}`)}
            onContextMenu={(e) => {
              e.preventDefault();
              ajouter(f);
            }}
            title={`Lancer 1d${f} (clic droit : l'ajouter au jet libre)`}
          >
            <span>d{f}</span>
          </button>
        ))}
      </div>
      <h2>Jet libre</h2>
      <div className="plateau-jet">
        <input value={expr} onChange={(e) => setExpr(e.target.value)} onKeyDown={(e) => e.key === "Enter" && lancer()} placeholder="1d20+5 · 1d8+2d6+3 · 4d6kh3 · 2d6r2 · d%" maxLength={60} />
        <div className="plateau-composer">
          {DES.map((f) => (
            <button key={f} onClick={() => ajouter(f)} title={`Ajouter un d${f}`}>+d{f}</button>
          ))}
          <button onClick={() => setExpr((x) => `${x}+1`)}>+1</button>
          <button onClick={() => setExpr((x) => `${x}-1`)}>−1</button>
          <button onClick={() => setExpr("")}>Vider</button>
        </div>
        <input value={raison} onChange={(e) => setRaison(e.target.value)} onKeyDown={(e) => e.key === "Enter" && lancer()} placeholder="Pour quoi ? (Attaque, Perception…)" maxLength={60} />
        <label className="plateau-coche" title="Coup critique : les dés de dégâts sont doublés, pas le modificateur">
          <input type="checkbox" checked={critique} onChange={(e) => setCritique(e.target.checked)} />
          Critique (dégâts doublés)
        </label>
        {mj && (
          <label className="plateau-coche">
            <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} />
            Jet secret (toi seul vois le résultat)
          </label>
        )}
        <button className="piste-lancer" onClick={() => lancer()}>Lancer</button>
        <p className="piste-vide">
          <code>kh3</code> garde les 3 meilleurs · <code>kl1</code> le pire · <code>r2</code> relance une fois les 1-2 ·
          20 naturel = réussite critique, 1 = échec critique.
        </p>
      </div>

      <h2>Fil de la table</h2>
      <ol className="plateau-fil">
        {[...fil].reverse().map((j) => {
          const masque = j.total === null;
          const mien = !!moi?.uid && j.uid === moi.uid;
          return (
            <li key={j.id} className={j.nat === 20 ? "crit" : j.nat === 1 ? "fumble" : ""}>
              <div>
                <b>{j.qui}</b>
                {j.raison && <span> · {j.raison}</span>}
                {j.cache && <em> 🔒 secret</em>}
                {j.critique && <em> 💥</em>}
                <strong>{masque ? "?" : j.total}</strong>
              </div>
              {!masque && (
                <small>
                  <code>{j.expr}</code>{" "}
                  {j.lignes.map((l, i) => (
                    <span key={i}>
                      <Ligne texte={l} />{" "}
                    </span>
                  ))}
                </small>
              )}
              <span className="plateau-fil-actions">
                {mj && j.cache && <button onClick={() => op({ op: "jet_reveler", id: j.id })}>📢 Révéler</button>}
                {mien && !masque && j.brut && (
                  <button onClick={() => op({ op: "jet", expr: j.brut, critique: !!j.critique, raison: j.raison, secret: j.cache })}>
                    🔁 Relancer
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
