"use client";

// Le quai : créer un salon, rejoindre avec un code, voir les salons publics, s'entraîner.

import { useState } from "react";
import type { VueQuai } from "@/lib/flotte";
import { Pavillon } from "./Emblemes";
import type { Reponse } from "./useFlotte";

export default function Quai({ vue, op, entrer, surAide }: {
  vue: VueQuai;
  op: (c: Record<string, unknown>) => Promise<Reponse>;
  entrer: (salon: string) => void;
  surAide: () => void;
}) {
  const [code, setCode] = useState("");
  const [prive, setPrive] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [refus, setRefus] = useState<string | null>(null);

  const agir = async (c: Record<string, unknown>, ensuite?: (r: Reponse) => Promise<void>) => {
    if (occupe) return;
    setOccupe(true);
    const r = await op(c);
    if (r.ok && ensuite) await ensuite(r);
    setOccupe(false);
    if (r.ok && r.salon) entrer(r.salon);
    else if (!r.ok) setRefus(r.erreur || "Refusé.");
  };

  const entrainement = () => agir({ op: "creer", public: false }, async (r) => {
    for (let i = 0; i < 2; i++) await op({ op: "bot", salon: r.salon });
  });

  return (
    <div className="fl-quai">
      <header className="fl-titre">
        <div className="fl-titre-pavillons" aria-hidden="true">
          {(["lion", "kraken", "rose", "dragon"] as const).map((p) => <Pavillon key={p} id={p} taille={40} />)}
        </div>
        <p className="fl-surtitre">La Taverne de Gaming présente</p>
        <h1>Guerre des Flottes Royales</h1>
        <p className="fl-accroche">
          Deux à huit capitaines, une mer semée d'îles et de récifs, un vent capricieux.
          Chaque manche, tous donnent leurs ordres en secret — puis tout se joue d'un coup.
        </p>
      </header>

      {vue.mon_salon && (
        <div className="fl-reprise">
          <span>Ta flotte t'attend dans une partie en cours.</span>
          <button className="fl-btn-principal" onClick={() => entrer(vue.mon_salon!)}>Reprendre la barre</button>
        </div>
      )}
      {refus && <p className="fl-refus" role="alert">{refus}</p>}

      <div className="fl-quai-grille">
        <section className="fl-carte-panneau">
          <h2>Armer une flotte</h2>
          <p className="fl-doux">Crée un salon, partage son code, et attends tes rivaux.</p>
          <label className="fl-case">
            <input type="checkbox" checked={prive} onChange={(e) => setPrive(e.target.checked)} />
            <span>Salon privé (n'apparaît pas au quai)</span>
          </label>
          <button className="fl-btn-principal" disabled={occupe} onClick={() => agir({ op: "creer", public: !prive })}>Hisser les voiles</button>
          <hr />
          <h3>Entraînement</h3>
          <p className="fl-doux">Un salon privé avec deux bots, pour apprendre les manœuvres (ajoutes-en jusqu'à sept).</p>
          <button className="fl-btn" disabled={occupe} onClick={entrainement}>S'entraîner contre des bots</button>
        </section>

        <section className="fl-carte-panneau">
          <h2>Rejoindre</h2>
          <form className="fl-rejoindre" onSubmit={(e) => { e.preventDefault(); agir({ op: "rejoindre", code }); }}>
            <label htmlFor="fl-code">Code du salon</label>
            <div>
              <input id="fl-code" value={code} maxLength={5} autoComplete="off" spellCheck={false}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="ABCDE" />
              <button className="fl-btn-principal" disabled={code.length !== 5 || occupe}>Embarquer</button>
            </div>
          </form>
          <h3>Salons ouverts</h3>
          {vue.salons.length === 0 ? (
            <p className="fl-doux">Aucun salon public pour l'instant — lance le tien !</p>
          ) : (
            <ul className="fl-ouverts">
              {vue.salons.map((s) => (
                <li key={s.id}>
                  <div>
                    <strong>Flotte de {s.hote}</strong>
                    <small>{s.joueurs}/8 capitaines · {s.options.manches} manches · {s.options.plan} s par ordre</small>
                  </div>
                  <button className="fl-btn" disabled={occupe} onClick={() => agir({ op: "rejoindre", code: s.code })}>Rejoindre</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <footer className="fl-quai-pied">
        <button className="fl-btn" onClick={surAide}>Comment jouer ?</button>
        <a className="fl-btn" href="/">Retour à la taverne</a>
      </footer>
    </div>
  );
}
