"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";

type Voyageur = {
  id: string; nom: string; baptise: boolean; nom_rp?: string | null;
  parles: number; cave: boolean; quete: boolean; fragments: number; monde?: string | null;
};

const MONDES: Record<string, string> = {
  in: "Salle", out: "Dehors", cave: "Cave", cimetiere: "Cimetière", chapelle: "Chapelle",
  reserve: "Réserve", chambre: "Chambre", chambre2: "Chambre 2", grenier: "Grenier",
};

async function action(nom: string, payload: object) {
  const res = await fetch(`/api/fripouille/action/bapteme/${nom}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

/** Phase de tests : voir où en est chaque voyageur de la Taverne 3D et le remettre au tout début
 *  (parcours seul, ou parcours + baptême), pour rejouer l'arrivée, les quêtes et le rite. */
export default function TaverneTesteurs() {
  const [liste, setListe] = useState<Voyageur[] | null>(null);
  const [q, setQ] = useState("");
  const [enCours, setEnCours] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try { setListe((await action("voyageurs", {})).voyageurs || []); } catch { setNote("La Fripouille est injoignable."); }
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const reinitialiser = async (v: Voyageur, bapteme: boolean) => {
    const quoi = bapteme ? "tout son parcours ET son baptême (rôles de race et de foi retirés, pseudo rendu)" : "tout son parcours (avancement, position, sacoche)";
    if (!window.confirm(`Remettre ${v.nom} au tout début : ${quoi} ?`)) return;
    setEnCours(v.id); setNote(null);
    try {
      const r = await action("reinitialiser", { user_id: v.id, bapteme });
      setNote(`${v.nom} repart de zéro${bapteme ? ", baptême compris" : ""}.${r.notes?.length ? " (" + r.notes.join(", ") + ")" : ""} Il doit recharger la page du jeu.`);
      await charger();
    } catch { setNote("Échec de la réinitialisation (bot injoignable ?)."); } finally { setEnCours(null); }
  };

  const s = q.trim().toLowerCase();
  const vus = (liste || []).filter((v) => !s || [v.nom, v.nom_rp || "", v.id].join(" ").toLowerCase().includes(s));

  return (
    <section className="cfg-card">
      <div className="cfg-card-head">
        <span className="cfg-card-icon"><Icon name="clepsydre" /></span>
        <div>
          <h2>Taverne 3D : remettre un voyageur au début</h2>
          <p>
            Pour la phase de tests. « Parcours » efface l'avancement (rencontres, énigme de Brom, cave, fragments
            d'Altus), la dernière position et la sacoche : il repart devant la taverne. « Parcours + baptême »
            le renvoie en plus chez le mage. L'économie n'est pas touchée.
          </p>
        </div>
      </div>
      <div className="reg-toolbar">
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher (nom, ID…)" aria-label="Rechercher" />
        <span className="reg-count">{vus.length} / {liste?.length ?? 0}</span>
        <div className="reg-actions"><button className="btn" onClick={charger}>Actualiser</button></div>
      </div>
      {note && <p className="cfg-hint">{note}</p>}
      {!liste ? <div className="empty-state">Chargement…</div> : vus.length === 0 ? <div className="empty-state">Aucun voyageur.</div> : (
        <div className="table-scroll">
          <table className="reg-table">
            <thead><tr><th>Voyageur</th><th>Baptême</th><th>Rencontres</th><th>Cave</th><th>Quête d'Altus</th><th>Où</th><th></th></tr></thead>
            <tbody>
              {vus.map((v) => (
                <tr key={v.id}>
                  <td>{v.nom}<div className="reg-id">{v.id}</div></td>
                  <td>{v.baptise ? (v.nom_rp || "oui") : "—"}</td>
                  <td>{v.parles}</td>
                  <td>{v.cave ? "ouverte" : "—"}</td>
                  <td>{v.quete ? `${v.fragments} / 5 fragments` : "—"}</td>
                  <td>{v.monde ? MONDES[v.monde] || v.monde : "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn" disabled={enCours === v.id} onClick={() => reinitialiser(v, false)}>Parcours</button>{" "}
                    <button className="btn danger" disabled={enCours === v.id} onClick={() => reinitialiser(v, true)}>Parcours + baptême</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
