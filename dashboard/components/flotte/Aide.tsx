"use client";

// Aide : règles, navires, vent, terrains, touches. Construite à partir des constantes du
// serveur quand elles sont connues (salon), sinon sur un résumé écrit.
import { useEffect, useRef } from "react";
import { ALLURES, TERRAINS, type Regles } from "@/lib/flotte";
import type { Reglages } from "./Bataille";

export default function Aide({ regles, reglages, changer, fermer }: {
  regles: Regles | null;
  reglages: Reglages;
  changer: (r: Reglages) => void;
  fermer: () => void;
}) {
  const boite = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = boite.current!;
    d.showModal();
    const f = () => fermer();
    d.addEventListener("close", f);
    return () => d.removeEventListener("close", f);
  }, [fermer]);

  return (
    <dialog ref={boite} className="fl-aide" aria-labelledby="fl-aide-titre">
      <header>
        <h2 id="fl-aide-titre">Manuel du capitaine</h2>
        <button className="fl-btn-icone" onClick={() => boite.current?.close()} aria-label="Fermer">✕</button>
      </header>
      <div className="fl-aide-corps">
        <section>
          <h3>Le but</h3>
          <p>Être le dernier capitaine à flot. Si la limite de manches tombe avant, on départage : navires à flot,
            puis coque restante, puis dégâts infligés. Quand il ne reste que deux capitaines, le brouillard se lève.</p>
          <h3>Une manche</h3>
          <ol>
            <li>Chacun donne en secret un cap et une action à chaque navire, puis verrouille.</li>
            <li>Tous les navires avancent en même temps, case par case. Deux navires qui visent la même case, s'échangent
              leur place ou percutent un navire immobile s'arrêtent et prennent 1 dégât de choc.</li>
            <li>Puis tous les tirs partent en même temps, depuis les nouvelles positions : il faut que la cible soit en vue,
              à portée et qu'aucune île ne masque la ligne de tir.</li>
            <li>Les ports réparent, la météo change (la prévision est annoncée une manche à l'avance).</li>
          </ol>
          <p>Tirer révèle ta position à ta cible. Sans ordre, un navire se met en garde ; trois manches sans aucun ordre
            et ta flotte amène son pavillon.</p>
        </section>
        {regles && (
          <section>
            <h3>Les navires</h3>
            <div className="fl-table-defile">
              <table className="fl-table">
                <thead><tr><th>Navire</th><th>Vitesse</th><th>Coque</th><th>Portée</th><th>Dégâts</th><th>Précision</th><th>Vision</th></tr></thead>
                <tbody>
                  {Object.values(regles.classes).map((k) => (
                    <tr key={k.nom}>
                      <td><strong>{k.nom}</strong><br /><small>{k.role}</small></td>
                      <td>{k.vitesse}</td><td>{k.coque}</td>
                      <td>{k.portee_min > 1 ? `${k.portee_min}–` : ""}{k.portee}</td>
                      <td>{k.degats}</td>
                      <td>{k.precision} % −{k.chute}/case</td>
                      <td>{k.vision}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p><strong>Chance de toucher</strong> = précision − chute × (distance − 1) − esquive de la cible (éclaireur : 10)
              + météo ; −{regles.garde} si la cible est en garde ; −{regles.lourd} pour un navire de siège qui a bougé.
              Bornée entre 5 et 95 %. {Math.round(regles.critique * 100)} % des touches sont des coups au but (+1 dégât).</p>
            <h3>Le vent</h3>
            <p>Chaque navire a vitesse × {regles.points} points de vent par manche (et au plus vitesse + {regles.pas_en_plus} pas).
              Un pas coûte selon l'allure :</p>
            <div className="fl-table-defile">
              <table className="fl-table">
                <thead><tr><th>Météo</th>{ALLURES.map((a) => <th key={a}>{a}</th>)}<th>Effets</th></tr></thead>
                <tbody>
                  {Object.entries(regles.temps).map(([id, t]) => (
                    <tr key={id}>
                      <td>{t.nom}</td>
                      {t.couts.map((c, i) => <td key={i}>{c}</td>)}
                      <td><small>
                        {[t.precision ? `tirs ${t.precision} %` : "", t.precision_loin ? `tirs lointains ${t.precision_loin} %` : "",
                          t.vision_max ? `vision max ${t.vision_max}` : "", t.vision ? `vision ${t.vision}` : "",
                          t.recif > 1 ? `récifs −${t.recif}` : ""].filter(Boolean).join(", ") || "—"}
                      </small></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        <section>
          <h3>Terrains</h3>
          <ul>{Object.values(TERRAINS).map((t) => <li key={t.nom}><strong>{t.nom}</strong> — {t.texte}</li>)}</ul>
          <h3>Commandes</h3>
          <ul>
            <li><strong>Clic / tap</strong> sur un de tes navires : le sélectionner. Sur une case dorée : fixer son cap.
              Sur un ennemi : le prendre pour cible (re-clic : annuler).</li>
            <li><strong>Glisser</strong> : déplacer la carte · <strong>molette / pincer</strong> : zoomer.</li>
            <li><strong>1–4</strong> : choisir un navire · <strong>Z E D X W Q</strong> (autour de S, AZERTY) : un pas dans une direction ·
              <strong> Retour arrière</strong> : annuler un pas · <strong>G</strong> : garde · <strong>T</strong> : cible suivante ·
              <strong> Entrée</strong> : verrouiller · <strong>C</strong> : recentrer · <strong>flèches</strong>, <strong>+ −</strong> : vue.</li>
          </ul>
        </section>
        <section>
          <h3>Réglages</h3>
          <label className="fl-case">
            <input type="checkbox" checked={reglages.reduit} onChange={(e) => changer({ ...reglages, reduit: e.target.checked })} />
            <span>Animations réduites (résolution sans mouvements, résultats affichés directement)</span>
          </label>
          <label className="fl-case">
            <input type="checkbox" checked={reglages.qualite === "basse"} onChange={(e) => changer({ ...reglages, qualite: e.target.checked ? "basse" : "haute" })} />
            <span>Qualité visuelle réduite (petites machines, téléphones)</span>
          </label>
        </section>
      </div>
    </dialog>
  );
}
