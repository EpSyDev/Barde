"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";

type Reglages = { veillee_actif: boolean; veillee_jour: number; veillee_heure: string; veillee_chapitre: number | null; veillee_demande: number };
type EtatHub = {
  chapitres: string[]; suivant: number; prochaine: string | null; derniere: string | null;
  en_cours: { titre: string; ecoule: number; duree: number } | null;
};

const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

async function action(nom: string, payload: object = {}) {
  const res = await fetch(`/api/fripouille/action/taverne3d/${nom}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}
const mmss = (s: number) => `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}`;

/** La veillée du conteur (Gaspard, au coin du feu) : programmation hebdomadaire, chapitre, et lancement
 *  immédiat. Le hub relit ces réglages toutes les 20 s et renvoie son état (chapitres, prochaine, en cours). */
export default function TaverneVeillee() {
  const [r, setR] = useState<Reglages | null>(null);
  const [hub, setHub] = useState<EtatHub | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    try { const d = await action("veillee_etat"); setR(d.reglages); setHub(d.hub); } catch { setNote("La Fripouille est injoignable."); }
  }, []);
  useEffect(() => { charger(); const t = setInterval(charger, 15000); return () => clearInterval(t); }, [charger]);

  const regler = async (maj: object) => {
    setOccupe(true); setNote(null);
    try { const d = await action("veillee_regler", maj); setR(d); } catch { setNote("Réglage refusé ou bot injoignable."); } finally { setOccupe(false); }
  };
  const lancer = async () => {
    if (!window.confirm("Lancer la veillée maintenant ? Gaspard commence dans 20 secondes au plus, pour tous les voyageurs.")) return;
    setOccupe(true);
    try { await action("veillee_lancer", r?.veillee_chapitre != null ? { chapitre: r.veillee_chapitre } : {}); setNote("Demande envoyée : le hub lance la veillée à son prochain passage (20 s au plus)."); }
    catch { setNote("Échec du lancement (bot injoignable ?)."); } finally { setOccupe(false); }
  };

  if (!r) return <section className="cfg-card"><div className="empty-state">{note || "Chargement de la veillée…"}</div></section>;
  const chapitres = hub?.chapitres || [];
  const suivant = r.veillee_chapitre ?? hub?.suivant ?? 0;

  return (
    <section className="cfg-card">
      <div className="cfg-card-head">
        <span className="cfg-card-icon"><Icon name="chandelle" /></span>
        <div>
          <h2>Taverne 3D : la veillée du conteur</h2>
          <p>
            Gaspard raconte un chapitre au coin du feu. Annonce sur Discord un quart d'heure avant ; les présents
            (restés près du feu la moitié du récit) reçoivent le gain « veillée ». Heure de Paris.
          </p>
        </div>
      </div>

      <div className="cfg-hint">
        {!hub ? "⚠️ Le hub de la Taverne ne répond pas (réglages gardés, appliqués à son retour)."
          : hub.en_cours ? `🔥 En cours : « ${hub.en_cours.titre} » — ${mmss(hub.en_cours.ecoule)} sur ${mmss(hub.en_cours.duree)}.`
            : hub.prochaine ? `Prochaine veillée : ${new Date(hub.prochaine).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}.`
              : "Aucune veillée programmée."}
        {hub?.derniere ? ` Dernière racontée : « ${hub.derniere} ».` : ""}
      </div>

      <label className="cfg-toggle">
        <input type="checkbox" checked={r.veillee_actif} disabled={occupe} onChange={(e) => regler({ actif: e.target.checked })} />
        <span className="switch" />
        <span>Veillée chaque semaine</span>
      </label>
      <div className="field-2col">
        <div className="cfg-field">
          <label>Jour</label>
          <select value={r.veillee_jour} disabled={occupe} onChange={(e) => regler({ jour: Number(e.target.value) })}>
            {JOURS.map((j, i) => <option key={j} value={i}>{j}</option>)}
          </select>
        </div>
        <div className="cfg-field">
          <label>Heure</label>
          <input type="time" value={r.veillee_heure} disabled={occupe} onChange={(e) => e.target.value && regler({ heure: e.target.value })} />
        </div>
      </div>
      <div className="cfg-field">
        <label>Chapitre de la prochaine veillée</label>
        <select value={r.veillee_chapitre ?? ""} disabled={occupe || !chapitres.length}
          onChange={(e) => regler({ chapitre: e.target.value === "" ? null : Number(e.target.value) })}>
          <option value="">Le suivant{chapitres.length ? ` (« ${chapitres[hub?.suivant ?? 0]} »)` : ""}</option>
          {chapitres.map((t, i) => <option key={i} value={i}>{`Chapitre ${i + 1} — ${t}`}</option>)}
        </select>
        <p className="cfg-hint">Un chapitre imposé ne vaut que pour la prochaine veillée ; ensuite on reprend à sa suite.</p>
      </div>
      <button className="btn primary" disabled={occupe || !!hub?.en_cours} onClick={lancer}>
        🔥 Lancer maintenant{chapitres.length ? ` « ${chapitres[suivant] ?? ""} »` : ""}
      </button>
      {note && <p className="cfg-hint">{note}</p>}
    </section>
  );
}
