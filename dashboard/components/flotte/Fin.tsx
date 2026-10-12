"use client";

// Écran de fin : vainqueur, classement, statistiques, revanche.
import { useState } from "react";
import { formatDuree, PAVILLONS, RAISONS_FIN, type VueSalon } from "@/lib/flotte";
import { Pavillon } from "./Emblemes";
import type { Reponse } from "./useFlotte";

export default function Fin({ vue, op, surQuai }: {
  vue: VueSalon;
  op: (c: Record<string, unknown>) => Promise<Reponse>;
  surQuai: () => void;
}) {
  const fin = vue.fin!;
  const [refus, setRefus] = useState<string | null>(null);
  const nom = (uid: string) => vue.joueurs.find((j) => j.uid === uid);
  const gagne = !!vue.moi && fin.gagnants.includes(vue.moi);
  const titre = fin.gagnants.length === 0 ? "Aucun survivant"
    : gagne ? (fin.gagnants.length > 1 ? "Victoire partagée !" : "Victoire !")
      : fin.gagnants.length > 1 ? `Victoire partagée : ${fin.gagnants.map((u) => nom(u)?.nom).join(", ")}`
        : `${nom(fin.gagnants[0])?.nom ?? "?"} règne sur les mers`;
  const revanche = async (meme_carte: boolean) => {
    const r = await op({ op: "revanche", salon: vue.id, meme_carte });
    if (!r.ok) setRefus(r.erreur || "Revanche refusée.");
  };

  return (
    <div className={`fl-fin${gagne ? " gagne" : ""}`} role="dialog" aria-modal="true" aria-labelledby="fl-fin-titre">
      <div className="fl-fin-carte">
        <p className="fl-surtitre">{RAISONS_FIN[fin.raison]} · {fin.manches} manche{fin.manches > 1 ? "s" : ""} · {formatDuree(fin.duree)}</p>
        <h1 id="fl-fin-titre">{titre}</h1>
        {fin.gagnants[0] && nom(fin.gagnants[0]) && (
          <div className="fl-fin-pavillons">{fin.gagnants.map((u) => nom(u) && <Pavillon key={u} id={nom(u)!.pavillon} taille={72} titre />)}</div>
        )}
        <div className="fl-table-defile">
          <table className="fl-classement">
            <thead>
              <tr><th>Rang</th><th>Capitaine</th><th>À flot</th><th>Précision</th><th>Dégâts</th><th>Coulés</th><th>Perdus</th></tr>
            </thead>
            <tbody>
              {fin.classement.map((c) => {
                const j = nom(c.uid);
                return (
                  <tr key={c.uid} className={c.uid === vue.moi ? "moi" : ""} style={{ "--camp": j ? PAVILLONS[j.pavillon].couleur : "#999" } as React.CSSProperties}>
                    <td>{c.rang}</td>
                    <td className="cap">{j && <Pavillon id={j.pavillon} taille={26} />}{j?.nom ?? "?"}{c.abandon ? " (abandon)" : ""}</td>
                    <td>{c.navires}{c.navires ? ` (${c.coque} pv)` : ""}</td>
                    <td>{c.precision === null ? "—" : `${c.precision} %`}</td>
                    <td>{c.degats}</td>
                    <td>{c.coules}</td>
                    <td>{c.perdus}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {vue.graine !== null && <p className="fl-doux">Carte n° {vue.graine} — rejouable à l'identique avec « Revanche, même carte ».</p>}
        {refus && <p className="fl-refus" role="alert">{refus}</p>}
        <div className="fl-fin-actions">
          {vue.peut.revanche ? (
            <>
              <button className="fl-btn-principal" onClick={() => revanche(true)}>Revanche, même carte</button>
              <button className="fl-btn" onClick={() => revanche(false)}>Revanche, nouvelle carte</button>
            </>
          ) : <p className="fl-doux">L'hôte peut relancer une revanche.</p>}
          <button className="fl-btn" onClick={surQuai}>Retour au quai</button>
          <a className="fl-btn" href="/">Retour à la taverne</a>
        </div>
      </div>
    </div>
  );
}
