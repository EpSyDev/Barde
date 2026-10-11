"use client";

// Onglet « Combat » : initiative partagée, comme sur Discord. Le MJ ouvre le combat ;
// chacun lance d20 + bonus (son héros est relié à son pion) ; le MJ ajoute ses créatures.
// Ordre trié (égalité : plus gros bonus devant), tour suivant (MJ, ou le joueur dont c'est
// le tour), compteur de rounds. Le pion dont c'est le tour s'allume sur la carte.

import { useState } from "react";
import type { Initiative, Moi, Op, Pion } from "./types";
import { estMJ } from "./types";

export default function Combat({ ini, pions, moi, op }: { ini: Initiative | undefined; pions: Pion[]; moi: Moi | null; op: Op }) {
  const mj = estMJ(moi);
  const monHeros = pions.find((p) => p.proprio && p.proprio === moi?.uid) || null;
  const [bonus, setBonus] = useState("0");
  const [nom, setNom] = useState("");
  const [cible, setCible] = useState("");
  const [secret, setSecret] = useState(false);

  if (!ini?.actif) {
    return (
      <div className="plateau-section">
        <h2>Initiative</h2>
        {mj ? (
          <button className="piste-lancer" onClick={() => op({ op: "init_ouvrir" })}>⚔️ Ouvrir l&apos;initiative</button>
        ) : (
          <p className="piste-vide">Pas de combat en cours. Le MJ ouvrira l&apos;initiative le moment venu.</p>
        )}
      </div>
    );
  }

  const courant = ini.entrees.find((e) => e.cle === ini.courant);
  const peutAvancer = mj || (ini.round > 0 && !!courant && courant.uid === moi?.uid);
  const lancerMoi = () => op({ op: "init_lancer", bonus, pion_id: monHeros?.id || "", nom: monHeros ? "" : nom });
  const creatures = pions.filter((p) => p.type !== "joueur");

  return (
    <div className="plateau-section">
      <h2>⚔️ Initiative{ini.round ? ` — round ${ini.round}` : ""}</h2>
      {ini.entrees.length === 0 ? (
        <p className="piste-vide">Personne n&apos;a encore lancé.</p>
      ) : (
        <ol className="plateau-init">
          {ini.entrees.map((e, i) => (
            <li key={e.cle} className={e.cle === ini.courant ? "on" : ""}>
              <span className="init-rang">{e.cle === ini.courant ? "▶" : `${i + 1}.`}</span>
              <span className="init-nom">{e.nom}</span>
              <b>{e.total}</b>
              <small>d20 {e.d20} {e.bonus >= 0 ? `+${e.bonus}` : e.bonus}</small>
              {mj && <button onClick={() => op({ op: "init_retirer", cle: e.cle })} title="Retirer">✕</button>}
            </li>
          ))}
        </ol>
      )}
      <button className="piste-lancer" disabled={!peutAvancer || ini.entrees.length === 0} onClick={() => op({ op: "init_suivant" })}>
        {ini.round ? "⏭️ Tour suivant" : "▶ Commencer le combat"}
      </button>
      {!peutAvancer && ini.round > 0 && <p className="piste-vide">Tu pourras passer la main quand ce sera ton tour.</p>}

      <h2>{mj ? "Mon jet" : "Lancer mon initiative"}</h2>
      <div className="plateau-jet">
        {monHeros ? <p className="piste-vide">Pour <b>{monHeros.nom}</b></p> : (
          <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder={`Nom (vide = ${moi?.acteur || "toi"})`} maxLength={40} />
        )}
        <label>
          Bonus d&apos;initiative
          <input type="text" inputMode="numeric" value={bonus} onChange={(e) => setBonus(e.target.value.replace(/[^\d-]/g, ""))} />
        </label>
        <button className="piste-lancer" onClick={lancerMoi}>🎲 Lancer d20 {Number(bonus) >= 0 ? `+${Number(bonus) || 0}` : bonus}</button>
      </div>

      {mj && (
        <>
          <h2>Ajouter une créature</h2>
          <div className="plateau-jet">
            <select value={cible} onChange={(e) => setCible(e.target.value)}>
              <option value="">— Créature sans pion (nom libre) —</option>
              {creatures.map((p) => (
                <option key={p.id} value={p.id}>{p.nom}</option>
              ))}
            </select>
            {!cible && <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Gobelin 1, Dragon…" maxLength={40} />}
            <label>
              Bonus
              <input type="text" inputMode="numeric" value={bonus} onChange={(e) => setBonus(e.target.value.replace(/[^\d-]/g, ""))} />
            </label>
            <label className="plateau-coche">
              <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} />
              Jet caché (le score reste visible dans l&apos;ordre)
            </label>
            <button
              className="piste-lancer"
              disabled={!cible && !nom.trim()}
              onClick={async () => {
                const d = await op({ op: "init_lancer", bonus, pion_id: cible, nom: cible ? "" : nom, secret });
                if (d) setNom("");
              }}
            >
              🎲 Lancer pour la créature
            </button>
          </div>
          <button className="plateau-suppr" onClick={() => window.confirm("Fin du combat ?") && op({ op: "init_fermer" })}>🏳️ Fin du combat</button>
        </>
      )}
    </div>
  );
}
